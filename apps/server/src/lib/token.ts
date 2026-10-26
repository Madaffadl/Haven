import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';

/**
 * Minimal HS256 verification.
 *
 * Hand-rolled rather than pulled from a library for one reason: the attack
 * surface of JWT libraries is almost entirely in the algorithm-agility they
 * provide (`alg: none`, HS/RS confusion). This accepts exactly one algorithm
 * and refuses to look at the header's opinion on the matter.
 */

const claimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  did: z.uuid(),
  /** 'app' or 'widget'. Widget tokens are short-lived and read-only. */
  scope: z.enum(['app', 'widget']).default('app'),
  exp: z.number().int(),
  iat: z.number().int(),
});

export type AccessClaims = z.infer<typeof claimsSchema>;

const b64urlToBuffer = (value: string): Buffer => Buffer.from(value, 'base64url');

export const verifyAccessToken = (token: string): AccessClaims | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: unknown;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'HS256'
  ) {
    return null;
  }

  const expected = createHmac('sha256', env.JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = b64urlToBuffer(signatureB64);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) return null;

  if (parsed.data.exp * 1000 <= Date.now()) return null;

  return parsed.data;
};
