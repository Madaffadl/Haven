import { deviceId, routes, updateMeSchema, userRoom } from '@haven/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  deleteAccount,
  getMe,
  listDevices,
  revokeDevice,
  updateProfile,
} from '../../infra/db/repositories/identity.js';
import { listCircles } from '../../infra/db/repositories/membership.js';
import { rebroadcastCircle } from '../../realtime/handlers/presence.js';
import type { HavenServer } from '../../realtime/types.js';
import { authenticateRequest } from '../authenticate.js';
import { ApiError, parse, unauthenticated } from '../errors.js';

const deviceParams = z.object({ deviceId });

export const meRoutes =
  (deps: { io: HavenServer }): FastifyPluginAsync =>
  async (app) => {
    app.get(routes.me, async (request) => {
      const auth = await authenticateRequest(request);
      const me = await getMe(auth.userId);
      if (!me) throw unauthenticated();
      return me;
    });

    /**
     * Name and accent show up on everyone's map straight away. Profiles only
     * travel with bootstraps, so each of the user's circles gets a fresh one.
     * Profile edits are rare, which is what makes the per-viewer queries
     * affordable.
     */
    app.patch(routes.me, async (request) => {
      const auth = await authenticateRequest(request);
      const { displayName, accentHex } = parse(updateMeSchema, request.body);

      const me = await updateProfile(auth.userId, {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(accentHex !== undefined ? { accentHex } : {}),
      });

      const circles = await listCircles(auth.userId);
      await Promise.all(circles.map((circle) => rebroadcastCircle(deps.io, circle.id)));

      return me;
    });

    app.get(routes.devices, async (request) => {
      const auth = await authenticateRequest(request);
      return listDevices(auth.userId, auth.deviceId);
    });

    /**
     * Sign another device out, effective immediately: its sockets are dropped
     * now, and the revoked session fails the handshake when it reconnects.
     * This device signs out through /auth/sign-out instead, which keeps "I'm
     * done here" and "that phone was stolen" as two clearly different acts.
     */
    app.delete(routes.device(':deviceId'), async (request, reply) => {
      const auth = await authenticateRequest(request);
      const params = parse(deviceParams, request.params);

      if (params.deviceId === auth.deviceId) {
        throw new ApiError(400, 'invalid_payload', 'use sign-out for this device');
      }
      if (!(await revokeDevice(auth.userId, params.deviceId))) {
        throw new ApiError(404, 'not_found', 'no such device');
      }

      const sockets = await deps.io.in(userRoom(auth.userId)).fetchSockets();
      for (const socket of sockets) {
        if (socket.data.deviceId === params.deviceId) socket.disconnect(true);
      }

      return reply.code(204).send();
    });

    /**
     * Delete the account. Every device is signed out, the person leaves
     * every circle, and their location is erased (repositories/identity.ts).
     * The circles they were in are re-bootstrapped, so they disappear from
     * everyone's map now rather than at the next reconnect.
     */
    app.delete(routes.me, async (request, reply) => {
      const auth = await authenticateRequest(request);
      const { circleIds } = await deleteAccount(auth.userId);

      deps.io.in(userRoom(auth.userId)).disconnectSockets(true);
      await Promise.all(circleIds.map((circleId) => rebroadcastCircle(deps.io, circleId)));

      return reply.code(204).send();
    });
  };
