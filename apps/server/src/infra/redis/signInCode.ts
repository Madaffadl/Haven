import {
  SIGN_IN_CODE_MAX_ATTEMPTS,
  SIGN_IN_CODE_TTL_S,
  signInCodeMatches,
} from '../../domain/identity/signInCode.js';
import { redis } from './client.js';

/**
 * Pending sign-in codes. Redis rather than Postgres: a code lives for ten
 * minutes and losing every pending one costs each person a "send again" tap,
 * which is exactly the kind of data docs/01 §4 keeps off the primary.
 *
 * One live code per address. Requesting a new one replaces the old, and with
 * it the attempt counter, which is why requesting is rate-limited separately.
 */

const key = (email: string): string => `signin:${email}`;

export const storeSignInCode = async (email: string, codeHash: string): Promise<void> => {
  await redis
    .multi()
    .del(key(email))
    .hset(key(email), 'hash', codeHash, 'attempts', 0)
    .expire(key(email), SIGN_IN_CODE_TTL_S)
    .exec();
};

/**
 * Counts the attempt and reads the hash atomically, and refuses to create the
 * key when it has already expired. A bare HINCRBY would resurrect an expired
 * code as a hash with no TTL that nothing ever cleans up.
 */
const ATTEMPT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return false
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return {attempts, redis.call('HGET', KEYS[1], 'hash')}
`;

export type CodeCheck = 'ok' | 'wrong' | 'expired';

export const checkSignInCode = async (
  secret: string,
  email: string,
  code: string,
): Promise<CodeCheck> => {
  const result = (await redis.eval(ATTEMPT_SCRIPT, 1, key(email))) as [number, string] | null;
  if (!result) return 'expired';

  const [attempts, storedHash] = result;

  if (attempts > SIGN_IN_CODE_MAX_ATTEMPTS) {
    await redis.del(key(email));
    return 'expired';
  }

  if (!signInCodeMatches(storedHash, secret, email, code)) return 'wrong';

  // Single use: a code that worked once must not work again from a second
  // device that happened to see the same email.
  await redis.del(key(email));
  return 'ok';
};
