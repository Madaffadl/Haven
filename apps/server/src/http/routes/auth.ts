import {
  refreshSchema,
  routes,
  startEmailSignInSchema,
  userRoom,
  verifyEmailSignInSchema,
  type DeviceInfo,
  type SignInResult,
  type TokenPair,
} from '@haven/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { env } from '../../config/env.js';
import { defaultDisplayName, pickAccent } from '../../domain/identity/profile.js';
import {
  REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  newRefreshToken,
} from '../../domain/identity/refreshToken.js';
import { generateSignInCode, hashSignInCode } from '../../domain/identity/signInCode.js';
import {
  createSession,
  findOrCreateUserByEmail,
  revokeSession,
  rotateRefreshToken,
} from '../../infra/db/repositories/identity.js';
import { emailSender } from '../../infra/email/index.js';
import {
  limitRefresh,
  limitSignInCodeForEmail,
  limitSignInCodeForIp,
} from '../../infra/redis/rateLimit.js';
import { checkSignInCode, storeSignInCode } from '../../infra/redis/signInCode.js';
import { signAccessToken } from '../../lib/token.js';
import type { HavenServer } from '../../realtime/types.js';
import { authenticateRequest } from '../authenticate.js';
import { ApiError, parse, rateLimited, unauthenticated } from '../errors.js';

/**
 * Passwordless sign-in.
 *
 *   start   email → code (emailed, or logged in development)
 *   verify  email + code → account (created on first sign-in) + session
 *   refresh refresh token → new access token + new refresh token
 *
 * Codes are HMAC'd with JWT_SECRET under a "sign-in:" prefix, so the one
 * secret serves both purposes without a code hash ever being usable as a
 * token signature or the other way round.
 */

const tokensFor = (
  session: { userId: string; sessionId: string; deviceId: string },
  refreshToken: string,
): TokenPair => {
  const access = signAccessToken({
    sub: session.userId,
    sid: session.sessionId,
    did: session.deviceId,
    scope: 'app',
  });
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt.toISOString(),
    refreshToken,
  };
};

const openSession = async (userId: string, device: DeviceInfo): Promise<TokenPair> => {
  const refreshToken = newRefreshToken();
  const { sessionId, deviceId } = await createSession({
    userId,
    device,
    refreshTokenHash: hashRefreshToken(refreshToken),
    ttlDays: REFRESH_TOKEN_TTL_DAYS,
  });
  return tokensFor({ userId, sessionId, deviceId }, refreshToken);
};

export const authRoutes =
  (deps: { io: HavenServer }): FastifyPluginAsync =>
  async (app) => {
    /**
     * Always 204, whether or not the address has an account: the response
     * must not tell a stranger who uses Haven.
     */
    app.post(routes.emailStart, async (request, reply) => {
      const { email } = parse(startEmailSignInSchema, request.body);

      const byEmail = await limitSignInCodeForEmail(email);
      if (!byEmail.allowed) throw rateLimited(byEmail.retryAfterMs);
      const byIp = await limitSignInCodeForIp(request.ip);
      if (!byIp.allowed) throw rateLimited(byIp.retryAfterMs);

      const code = generateSignInCode();
      await storeSignInCode(email, hashSignInCode(env.JWT_SECRET, email, code));
      await emailSender.sendSignInCode(email, code);

      return reply.code(204).send();
    });

    // 400, not 401, for a wrong code: the app treats 401 as "refresh and
    // retry", which is meaningless before there is a session to refresh.
    app.post(routes.emailVerify, async (request) => {
      const { email, code, device } = parse(verifyEmailSignInSchema, request.body);

      const check = await checkSignInCode(env.JWT_SECRET, email, code);
      if (check === 'expired') {
        throw new ApiError(400, 'code_expired', 'this code has expired, request a new one');
      }
      if (check === 'wrong') throw new ApiError(400, 'invalid_code', 'that code is not right');

      const user = await findOrCreateUserByEmail({
        email,
        displayName: defaultDisplayName(email),
        accentHex: pickAccent(),
      });
      if (user.status === 'deleted') {
        throw new ApiError(403, 'forbidden', 'this account has been deleted');
      }

      const result: SignInResult = {
        tokens: await openSession(user.me.userId, device),
        me: user.me,
        isNewUser: user.created,
      };
      return result;
    });

    /**
     * Rotation means two refreshes racing with the same token leave one of
     * them signed out. The app serialises its refreshes for that reason
     * (core/api in the mobile app); a second process, such as the widget,
     * gets its own session rather than sharing this one.
     */
    app.post(routes.refresh, async (request) => {
      const limit = await limitRefresh(request.ip);
      if (!limit.allowed) throw rateLimited(limit.retryAfterMs);

      const { refreshToken } = parse(refreshSchema, request.body);
      const next = newRefreshToken();

      const session = await rotateRefreshToken({
        currentHash: hashRefreshToken(refreshToken),
        nextHash: hashRefreshToken(next),
        ttlDays: REFRESH_TOKEN_TTL_DAYS,
      });
      if (!session) throw unauthenticated();

      return tokensFor(session, next);
    });

    /** Ends this device's session and drops its live sockets with it. */
    app.post(routes.signOut, async (request, reply) => {
      const auth = await authenticateRequest(request);
      await revokeSession(auth.sessionId);

      const sockets = await deps.io.in(userRoom(auth.userId)).fetchSockets();
      for (const socket of sockets) {
        if (socket.data.sessionId === auth.sessionId) socket.disconnect(true);
      }

      return reply.code(204).send();
    });
  };
