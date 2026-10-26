import { z } from 'zod';

/**
 * Parsed once at boot. A missing DATABASE_URL must kill the process on line
 * one, not surface as a null deref during the first location report.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

  DATABASE_URL: z.url(),
  /** Keep modest: Socket.IO handlers are short and must not queue on the pool. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(100).default(20),

  REDIS_URL: z.url(),

  /** HMAC key for access tokens. 32+ bytes. */
  JWT_SECRET: z.string().min(32),

  OPEN_METEO_BASE_URL: z.url().default('https://api.open-meteo.com/v1'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
