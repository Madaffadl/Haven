/* eslint-disable no-console -- a CLI: stdout is its interface */
import '../../config/dotenv.js';

import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { z } from 'zod';

/**
 * Applies infra/db/migrations/*.sql in filename order, each exactly once.
 *
 * Reads DATABASE_URL directly instead of going through config/env.ts: a fresh
 * checkout must be able to build its schema before Redis or a JWT secret
 * exist.
 *
 * Each file runs in one transaction together with its schema_migrations row.
 * The files are idempotent at the extension level but not at the table level
 * (docs/01 §8), so a half-applied file would leave a schema that can be
 * neither re-run nor skipped. A failure rolls the whole file back.
 *
 * The lock is transaction-scoped, not session-scoped, so two runners still
 * exclude each other through a transaction-mode pooler (PgBouncer, Neon's
 * -pooler hosts), where consecutive statements may not share a session.
 */

const MIGRATIONS_DIR = new URL('../../../../../infra/db/migrations/', import.meta.url);

/** Arbitrary but fixed: every runner against the same database contends on it. */
const LOCK_KEY = 4_247_001;

const databaseUrl = z.url().safeParse(process.env['DATABASE_URL']);

if (!databaseUrl.success) {
  console.error(
    'DATABASE_URL is missing or not a URL.\n' +
      'Copy apps/server/.env.example to apps/server/.env and fill it in.',
  );
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl.data,
  // Serverless Postgres (Neon) suspends when idle; the first connection after
  // a suspend can take a few seconds to wake the compute.
  connectionTimeoutMillis: 15_000,
});

/** Postgres reports a character offset into the file; people read lines. */
const lineOf = (sql: string, error: unknown): string => {
  const position = Number((error as { position?: string }).position);
  return Number.isInteger(position) ? `:${sql.slice(0, position).split('\n').length}` : '';
};

const migrate = async (): Promise<void> => {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  let applied = 0;

  for (const file of files) {
    const version = file.slice(0, -'.sql'.length);
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');

    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);

      // Checked under the lock: a concurrent runner may have applied it
      // between our listing the directory and acquiring the lock.
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
        version,
      ]);
      if (done.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }

      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');

      applied += 1;
      console.log(`applied  ${version}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}${lineOf(sql, error)} failed and was rolled back: ${message}`, {
        cause: error,
      });
    }
  }

  console.log(applied === 0 ? 'schema is up to date' : `${applied} migration(s) applied`);
};

migrate()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void client.end());
