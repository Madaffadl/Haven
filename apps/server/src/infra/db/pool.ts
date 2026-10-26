import pg from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

const { Pool, types } = pg;

// node-postgres hands back BIGINT as a string to avoid precision loss. Every
// bigint we select is a grid index or a count that fits in a double, so parse
// them as numbers and keep the repositories free of string arithmetic.
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // A socket handler that cannot get a connection in 5s should fail the ack
  // and let the client retry, rather than piling up and taking the node down.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'idle postgres client error');
});

export const closePool = async (): Promise<void> => {
  await pool.end();
};
