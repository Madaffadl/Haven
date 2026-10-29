import { createHash, randomBytes } from 'node:crypto';

/**
 * Refresh tokens: 256 random bits, of which the database only ever sees a
 * SHA-256 (`auth_sessions.refresh_token_hash`).
 *
 * A plain hash, not an HMAC or a slow KDF, because the input is already
 * full-entropy: there is nothing to brute-force, so the only job is to make a
 * leaked table useless for signing in.
 */

/** A phone that stays untouched for two months signs in again. */
export const REFRESH_TOKEN_TTL_DAYS = 60;

export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export const hashRefreshToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();
