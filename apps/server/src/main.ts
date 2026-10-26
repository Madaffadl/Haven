import Fastify from 'fastify';

import { env } from './config/env.js';
import { closePool, pool } from './infra/db/pool.js';
import { closeRedis, redis } from './infra/redis/client.js';
import { logger } from './lib/logger.js';
import { createGateway } from './realtime/gateway.js';

const app = Fastify({ loggerInstance: logger });

app.get('/health', async (_request, reply) => {
  // Checks dependencies, not just liveness: a node that cannot reach Postgres
  // should leave the load balancer rather than accept sockets it will fail.
  const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);

  const detail = { db: db.status === 'fulfilled', redis: cache.status === 'fulfilled' };
  const healthy = detail.db && detail.redis;

  return reply.code(healthy ? 200 : 503).send({ ok: healthy, ...detail });
});

const start = async (): Promise<void> => {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  createGateway(app.server);
  logger.info({ port: env.PORT }, 'haven server listening');
};

/**
 * Drain before exiting. An abrupt kill drops every socket at once and the
 * whole fleet reconnects in a thundering herd — the classic way a routine
 * deploy becomes an outage.
 */
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'shutting down');
  try {
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'unclean shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
