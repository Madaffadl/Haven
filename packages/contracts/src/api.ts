import { z } from 'zod';

/**
 * The REST surface: sign-in, the signed-in user, circles and invites.
 *
 * Realtime state flows over the socket (./socket); REST carries the rare,
 * request-shaped operations around it. Paths live here for the same reason
 * the socket event map does: both ends import one definition, so a renamed
 * route is a compile error rather than a 404 in production.
 */
export const routes = {
  emailStart: '/v1/auth/email/start',
  emailVerify: '/v1/auth/email/verify',
  refresh: '/v1/auth/refresh',
  signOut: '/v1/auth/sign-out',
  me: '/v1/me',
  circles: '/v1/circles',
  // Parameterised paths take an already-validated value (a UUID, or a code
  // through inviteCodeSchema), never raw input. The server registers them
  // with ':circleId' / ':code', so they must not be URL-encoded here.
  circleInvites: (circleId: string) => `/v1/circles/${circleId}/invites`,
  invite: (code: string) => `/v1/invites/${code}`,
  acceptInvite: (code: string) => `/v1/invites/${code}/accept`,
} as const;

export const apiErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'invalid_payload',
  'rate_limited',
  'not_found',
  /** Wrong sign-in code. The client may let the user try again. */
  'invalid_code',
  /** No live code for this address: expired, used, or too many wrong tries. */
  'code_expired',
  /** Unknown, expired, revoked or used-up invite. Deliberately one code for all four. */
  'invite_invalid',
  'circle_full',
  'internal',
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Present on 'rate_limited'. */
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
