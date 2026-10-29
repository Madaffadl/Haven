import { redis } from './client.js';

/**
 * Sliding-window rate limiting, evaluated atomically in Lua.
 *
 * Atomicity matters more than it looks: the obvious INCR-then-EXPIRE pair
 * races under concurrent sockets, and a lost EXPIRE leaves a key that never
 * resets — the user is then rate-limited forever. One script, one round trip,
 * no race.
 */

const SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('PEXPIRE', key, window)
end

local ttl = redis.call('PTTL', key)
if count > limit then
  return {0, ttl}
end
return {1, ttl}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export const consume = async (
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> => {
  const [allowed, ttl] = (await redis.eval(SCRIPT, 1, key, limit, windowMs)) as [number, number];
  return { allowed: allowed === 1, retryAfterMs: Math.max(0, ttl) };
};

// ---------------------------------------------------------------------------
// Named limits
// ---------------------------------------------------------------------------

/**
 * Location reports. Generous, because a legitimate client in `driving` mode
 * reports every 30s and we must not throttle the one case where freshness
 * actually matters. This is an abuse ceiling, not a cadence control — cadence
 * is the server-issued UploadPolicy.
 */
export const limitLocationReport = (userId: string): Promise<RateLimitResult> =>
  consume(`rl:loc:${userId}`, 60, 60_000);

/**
 * Nudges, limited per recipient and per sender.
 *
 * Without this, "one-tap affection" becomes a notification weapon: a member
 * can tap a heart thirty times in ten seconds and the recipient's phone
 * buzzes thirty times. That is precisely the anxiety the product exists to
 * remove, so the limit is a product requirement rather than infrastructure
 * hygiene — which is why the numbers live in @haven/contracts.
 */
export const limitNudgeFromSender = (userId: string, perMinute: number) =>
  consume(`rl:nudge:from:${userId}`, perMinute, 60_000);

export const limitNudgeToRecipient = (senderId: string, recipientId: string, perMinute: number) =>
  consume(`rl:nudge:to:${recipientId}:${senderId}`, perMinute, 60_000);

/**
 * Sign-in code requests, per address. Each one sends a real email from a
 * free-tier quota, and each one resets the guess counter on the code, so this
 * limit is what actually bounds code guessing.
 */
export const limitSignInCodeForEmail = (email: string) =>
  consume(`rl:signin:email:${email}`, 3, 15 * 60_000);

/**
 * Per client address, so one script cannot spend the whole day's email quota
 * on other people's inboxes. Loose enough for a household behind one NAT.
 */
export const limitSignInCodeForIp = (ip: string) => consume(`rl:signin:ip:${ip}`, 20, 60 * 60_000);

/**
 * Session refreshes per client address. Keyed by IP because the caller is by
 * definition not authenticated yet. A healthy phone needs about four an hour;
 * the headroom is for a household sharing one address.
 */
export const limitRefresh = (ip: string) => consume(`rl:refresh:ip:${ip}`, 60, 60 * 60_000);

/**
 * Looking up and accepting invites. A code is a bearer credential for
 * someone's location, so guessing them must be impractical even though the
 * space is large.
 */
export const limitInviteLookup = (userId: string) =>
  consume(`rl:invite:${userId}`, 20, 10 * 60_000);

/**
 * Trust Mode changes that are not a move to ghost (see handlers/trust.ts:
 * hiding is never limited). Ten a minute is far beyond anyone deciding
 * between options, and well short of a script.
 */
export const limitTrustChange = (userId: string) => consume(`rl:trust:${userId}`, 10, 60_000);
