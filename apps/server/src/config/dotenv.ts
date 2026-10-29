import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads apps/server/.env for local development, wherever the process was
 * started from. Deployed environments set real variables and ship no file,
 * so a missing file is the normal case there, not an error.
 *
 * Variables already present in the environment win over the file.
 *
 * Import for side effect, before anything reads process.env.
 */
const path = fileURLToPath(new URL('../../.env', import.meta.url));

if (existsSync(path)) process.loadEnvFile(path);
