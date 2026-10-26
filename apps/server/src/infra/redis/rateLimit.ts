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
