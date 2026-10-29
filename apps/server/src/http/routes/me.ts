import { routes, updateMeSchema } from '@haven/contracts';
import type { FastifyPluginAsync } from 'fastify';

import { getMe, updateDisplayName } from '../../infra/db/repositories/identity.js';
import { listCircles } from '../../infra/db/repositories/membership.js';
import { rebroadcastCircle } from '../../realtime/handlers/presence.js';
import type { HavenServer } from '../../realtime/types.js';
import { authenticateRequest } from '../authenticate.js';
import { parse, unauthenticated } from '../errors.js';

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
     * A new name shows up on everyone's map straight away. Profiles only
     * travel with bootstraps, so each of the user's circles gets a fresh one.
     * Renaming is rare, which is what makes the per-viewer queries affordable.
     */
    app.patch(routes.me, async (request) => {
      const auth = await authenticateRequest(request);
      const { displayName } = parse(updateMeSchema, request.body);

      const me = await updateDisplayName(auth.userId, displayName);

      const circles = await listCircles(auth.userId);
      await Promise.all(circles.map((circle) => rebroadcastCircle(deps.io, circle.id)));

      return me;
    });
  };
