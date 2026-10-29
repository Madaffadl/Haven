import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { SIGN_IN_CODE_LENGTH } from '@haven/contracts';

/**
 * One-time sign-in codes. Pure: the secret is a parameter, storage is
 * infra/redis/signInCode.ts.
 */

/** Long enough to switch to the mail app and back on a slow connection. */
export const SIGN_IN_CODE_TTL_S = 10 * 60;

/**
 * Wrong guesses allowed per code before it is burned. With the per-address
 * limit on requesting codes, that caps an attacker at a few dozen guesses an
 * hour against a space of a million.
 */
export const SIGN_IN_CODE_MAX_ATTEMPTS = 5;

export const generateSignInCode = (): string =>
  randomInt(0, 10 ** SIGN_IN_CODE_LENGTH)
    .toString()
    .padStart(SIGN_IN_CODE_LENGTH, '0');

/**
 * Stored as an HMAC bound to the address, never in clear: a Redis snapshot
 * or a misdirected `MONITOR` must not hand out working codes, and binding the
 * address means a code issued to one inbox cannot be replayed for another.
 */
export const hashSignInCode = (secret: string, email: string, code: string): string =>
  createHmac('sha256', secret).update(`sign-in:${email}:${code}`).digest('base64url');

export const signInCodeMatches = (
  storedHash: string,
  secret: string,
  email: string,
  code: string,
): boolean => {
  const expected = Buffer.from(storedHash, 'base64url');
  const actual = Buffer.from(hashSignInCode(secret, email, code), 'base64url');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
