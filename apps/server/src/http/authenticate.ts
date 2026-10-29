import type { FastifyRequest } from 'fastify';

import { isSessionLive } from '../infra/db/repositories/identity.js';
import { verifyAccessToken } from '../lib/token.js';
import { unauthenticated } from './errors.js';

export interface RequestAuth {
  userId: string;
  deviceId: string;
  sessionId: string;
}

/**
 * The REST twin of realtime/middleware/authenticate.ts, with the same rule:
 * the token says who you claim to be, the session row says whether that is
 * still true. One indexed lookup per request is cheap for endpoints that run
 * a handful of times per user per day.
 *
 * Called explicitly at the top of each handler rather than as a hook, so the
 * only way for a handler to learn who is calling is to have authenticated.
 */
export const authenticateRequest = async (request: FastifyRequest): Promise<RequestAuth> => {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  const claims = token ? verifyAccessToken(token) : null;
  // Widget tokens will get their own read-only endpoint; they never act as the app.
  if (!claims || claims.scope !== 'app') throw unauthenticated();

  if (!(await isSessionLive(claims))) throw unauthenticated();

  return { userId: claims.sub, deviceId: claims.did, sessionId: claims.sid };
};
