import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

/**
 * Redis holds presence, rate-limit counters and the Socket.IO pub/sub
 * adapter — all of it reconstructible. Losing Redis costs a reconnect storm,
 * not data. That is deliberate: it lets the realtime tier scale horizontally
 * without any distributed-consensus problem.
 *
 * The adapter needs dedicated pub and sub connections; a subscribed ioredis
 * client cannot run ordinary commands.
 */
const options = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
} as const;

export const redis = new Redis(env.REDIS_URL, options);
export const redisPub = new Redis(env.REDIS_URL, options);
export const redisSub = redisPub.duplicate();

export const closeRedis = async (): Promise<void> => {
  await Promise.allSettled([redis.quit(), redisPub.quit(), redisSub.quit()]);
};
