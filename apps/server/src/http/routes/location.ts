import { locationReportSchema, routes } from '@haven/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { getMembershipContext } from '../../infra/db/repositories/location.js';
import { limitLocationReport } from '../../infra/redis/rateLimit.js';
import { ingestLocationReport } from '../../realtime/handlers/location.js';
import type { HavenServer } from '../../realtime/types.js';
import { authenticateRequest } from '../authenticate.js';
import { parse, rateLimited } from '../errors.js';

/**
 * Location reports over HTTPS, for the background task.
 *
 * A phone woken in a pocket for a location update has a few seconds of
 * runtime, and its socket is usually long gone: reconnecting and
 * re-authenticating a WebSocket for one report would cost more radio time
 * than the report itself. One request, the same pipeline as the socket
 * event, and the next upload policy in the response.
 *
 * Memberships are read per request instead of from a socket's cache. At
 * background cadence (30 s at the very fastest) that is one indexed query
 * per report.
 */
export const locationRoutes =
  (deps: { io: HavenServer }): FastifyPluginAsync =>
  async (app) => {
    app.post(routes.location, async (request) => {
      const auth = await authenticateRequest(request);

      const limit = await limitLocationReport(auth.userId);
      if (!limit.allowed) throw rateLimited(limit.retryAfterMs);

      const report = parse(locationReportSchema, request.body);

      return ingestLocationReport({
        io: deps.io,
        userId: auth.userId,
        deviceId: auth.deviceId,
        report,
        memberships: await getMembershipContext(auth.userId),
        lastBroadcast: null,
        senderSocketId: null,
      });
    });
  };
