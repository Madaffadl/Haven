import { redis } from './client.js';

/**
 * Who currently has a live socket.
 *
 * Kept out of Postgres entirely. Connects and disconnects are the highest-
 * frequency, lowest-value events in the system — phones sleep, wake, switch
 * from wifi to LTE constantly — and writing each one to the primary would
 * make the busiest write also the least useful.
 *
 * Multi-device aware: a user is online while *any* of their sockets is open,
 * so the key is a set of socket ids rather than a flag.
 */

const key = (userId: string): string => `presence:${userId}`;

/** Safety net for sockets lost to a hard process kill (no disconnect event). */
const PRESENCE_TTL_SECONDS = 90;

/** Returns true when this was the user's first socket — i.e. they came online. */
export const markOnline = async (userId: string, socketId: string): Promise<boolean> => {
  const results = await redis
    .multi()
    .scard(key(userId))
    .sadd(key(userId), socketId)
    .expire(key(userId), PRESENCE_TTL_SECONDS)
    .exec();

  const before = results?.[0]?.[1];
  return typeof before === 'number' && before === 0;
};

/** Returns true when this was the user's last socket — i.e. they went offline. */
export const markOffline = async (userId: string, socketId: string): Promise<boolean> => {
  const remaining = await redis.multi().srem(key(userId), socketId).scard(key(userId)).exec();
  const count = remaining?.[1]?.[1];
  return typeof count === 'number' && count === 0;
};

/** Called on heartbeat so a long-lived socket does not expire out of the set. */
export const refreshPresence = async (userId: string): Promise<void> => {
  await redis.expire(key(userId), PRESENCE_TTL_SECONDS);
};

export const isOnline = async (userId: string): Promise<boolean> =>
  (await redis.scard(key(userId))) > 0;

/**
 * Bulk variant for bootstrap: one pipeline instead of N round trips. A circle
 * of eight otherwise costs eight RTTs on every connect.
 */
export const onlineStatuses = async (userIds: string[]): Promise<Map<string, boolean>> => {
  if (userIds.length === 0) return new Map();

  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.scard(key(id));
  const results = await pipeline.exec();

  return new Map(
    userIds.map((id, index) => {
      const value = results?.[index]?.[1];
      return [id, typeof value === 'number' && value > 0];
    }),
  );
};

/**
 * Does anyone who can see this user currently have the app open?
 *
 * Drives the idle branch of the upload policy — if nobody is watching, there
 * is no reason to spend the member's battery on a fresh GPS fix.
 */
export const hasLiveViewers = async (
  viewerIds: readonly string[],
  selfId: string,
): Promise<boolean> => {
  const others = viewerIds.filter((id) => id !== selfId);
  if (others.length === 0) return false;

  const statuses = await onlineStatuses(others);
  return [...statuses.values()].some(Boolean);
};
