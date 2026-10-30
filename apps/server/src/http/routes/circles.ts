import {
  circleId,
  createCircleSchema,
  inviteCodeSchema,
  routes,
  type AcceptInviteResult,
} from '@haven/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  acceptInvite,
  createCircle,
  createInvite,
  leaveCircle,
  listCircles,
  previewInvite,
} from '../../infra/db/repositories/membership.js';
import { limitInviteLookup } from '../../infra/redis/rateLimit.js';
import { resyncMembership } from '../../realtime/membershipSync.js';
import type { HavenServer } from '../../realtime/types.js';
import { authenticateRequest } from '../authenticate.js';
import { ApiError, parse, rateLimited } from '../errors.js';

const circleParams = z.object({ circleId });
const codeParams = z.object({ code: inviteCodeSchema });

/**
 * One message for every way an invite can be unusable. Telling unknown codes
 * apart from expired ones would let someone enumerate which codes once
 * existed.
 */
const inviteInvalid = (): ApiError =>
  new ApiError(404, 'invite_invalid', 'this invite is not valid any more');

export const circleRoutes =
  (deps: { io: HavenServer }): FastifyPluginAsync =>
  async (app) => {
    app.get(routes.circles, async (request) => {
      const auth = await authenticateRequest(request);
      return listCircles(auth.userId);
    });

    app.post(routes.circles, async (request, reply) => {
      const auth = await authenticateRequest(request);
      const { name, kind } = parse(createCircleSchema, request.body);

      const circle = await createCircle({ userId: auth.userId, name, kind });
      await resyncMembership(deps.io, auth.userId, circle.id);

      return reply.code(201).send(circle);
    });

    app.post(routes.circleInvites(':circleId'), async (request, reply) => {
      const auth = await authenticateRequest(request);
      const params = parse(circleParams, request.params);

      const result = await createInvite({ userId: auth.userId, circleId: params.circleId });
      if (result.status === 'not_a_member') {
        throw new ApiError(403, 'forbidden', 'you are not in this circle');
      }
      if (result.status === 'circle_full') {
        throw new ApiError(409, 'circle_full', 'this circle has no open seats');
      }

      return reply.code(201).send(result.invite);
    });

    /**
     * Leave a circle. The member vanishes from everyone's map at once (fresh
     * bootstraps), and their own sockets reconnect without the circle.
     */
    app.post(routes.leaveCircle(':circleId'), async (request, reply) => {
      const auth = await authenticateRequest(request);
      const params = parse(circleParams, request.params);

      const outcome = await leaveCircle({ userId: auth.userId, circleId: params.circleId });
      if (outcome === 'not_a_member') {
        throw new ApiError(404, 'not_found', 'you are not in this circle');
      }

      await resyncMembership(deps.io, auth.userId, params.circleId);
      return reply.code(204).send();
    });

    app.get(routes.invite(':code'), async (request) => {
      const auth = await authenticateRequest(request);
      const limit = await limitInviteLookup(auth.userId);
      if (!limit.allowed) throw rateLimited(limit.retryAfterMs);

      const { code } = parse(codeParams, request.params);
      const preview = await previewInvite(code, auth.userId);
      if (!preview) throw inviteInvalid();
      return preview;
    });

    app.post(routes.acceptInvite(':code'), async (request) => {
      const auth = await authenticateRequest(request);
      const limit = await limitInviteLookup(auth.userId);
      if (!limit.allowed) throw rateLimited(limit.retryAfterMs);

      const { code } = parse(codeParams, request.params);
      const outcome = await acceptInvite({ code, userId: auth.userId });

      if (outcome.status === 'invite_invalid') throw inviteInvalid();
      if (outcome.status === 'circle_full') {
        throw new ApiError(409, 'circle_full', 'this circle is already full');
      }

      if (outcome.status === 'joined') {
        await resyncMembership(deps.io, auth.userId, outcome.circle.id);
      }

      const result: AcceptInviteResult = {
        circle: outcome.circle,
        joined: outcome.status === 'joined',
      };
      return result;
    });
  };
