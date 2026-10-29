import { circleRoom, setTrustSchema, type Ack } from '@haven/contracts';

import { newPhaseSalt } from '../../domain/location/fuzz.js';
import { isMember } from '../../infra/db/repositories/circle.js';
import {
  getMembershipContext,
  seedAnchorFromCurrentPosition,
} from '../../infra/db/repositories/location.js';
import { applyTrustChange, clearAnchors } from '../../infra/db/repositories/trust.js';
import { limitTrustChange } from '../../infra/redis/rateLimit.js';
import type { HandlerContext } from '../types.js';
import { rebroadcastCircle } from './presence.js';

/**
 * Trust Mode changes.
 *
 * Ordering is the whole correctness story here, and it runs strictest-first:
 *
 *   1. persist the change + audit row (one transaction)
 *   2. seed or clear fuzz anchors for every affected circle
 *   3. invalidate this socket's caches
 *   4. tell clients to DROP what they have cached
 *   5. send fresh per-viewer bootstraps
 *
 * Step 4 precedes step 5 deliberately. If we sent the new state first and
 * relied on it overwriting the old, any client that missed the update would
 * keep showing a precise position its owner had just hidden. Telling clients
 * to forget, then telling them the truth, fails safe in both orders of
 * arrival.
 */
export const handleSetTrust = async (
  ctx: HandlerContext,
  raw: unknown,
  ack: Ack<null>,
): Promise<void> => {
  const { io, socket } = ctx;
  const userId = socket.data.userId;

  const parsed = setTrustSchema.safeParse(raw);
  if (!parsed.success) {
    ack({ ok: false, error: { code: 'invalid_payload', message: 'malformed trust setting' } });
    return;
  }

  const { circleId, mode, fuzzRadiusM } = parsed.data;

  // Each change costs a transaction and a per-viewer bootstrap for every
  // member of every affected circle, so a toggle tapped in a loop is limited.
  // Never on the way to ghost: hiding is the escape hatch, and a rate limit
  // must not be able to stand between someone and going dark.
  if (mode !== 'ghost') {
    const limit = await limitTrustChange(userId);
    if (!limit.allowed) {
      ack({
        ok: false,
        error: {
          code: 'rate_limited',
          message: 'too many Trust Mode changes',
          retryAfterMs: limit.retryAfterMs,
        },
      });
      return;
    }
  }

  if (circleId && !(await isMember(userId, circleId))) {
    ack({ ok: false, error: { code: 'not_a_member', message: 'not a member of this circle' } });
    return;
  }

  const { affectedCircleIds } = await applyTrustChange({
    userId,
    // A member may only ever change their own privacy. The actor is recorded
    // separately so that stays visible in the audit trail if it changes.
    actorId: userId,
    deviceId: socket.data.deviceId,
    circleId,
    mode,
    ...(fuzzRadiusM !== undefined ? { fuzzRadiusM } : {}),
  });

  if (mode === 'approximate') {
    // Seed an anchor immediately from the last known position. The projection
    // fails closed without one, so skipping this would show the member as
    // "location unavailable" until their next scheduled report — which reads
    // as the privacy toggle having broken something.
    await Promise.all(
      affectedCircleIds.map((id) =>
        seedAnchorFromCurrentPosition({
          userId,
          circleId: id,
          radiusM: fuzzRadiusM ?? 1000,
          phaseSalt: newPhaseSalt(),
        }),
      ),
    );
  } else {
    // Leaving Approximate must not leave a stale cell behind: it would be
    // reused — at the old scale — if the member switched back later.
    await clearAnchors({ userId, circleIds: affectedCircleIds });
  }

  socket.data.memberships = await getMembershipContext(userId);
  for (const id of affectedCircleIds) {
    socket.data.lastBroadcast.delete(id);
  }

  for (const id of affectedCircleIds) {
    io.to(circleRoom(id)).emit('trust:changed', { circleId: id, userId, mode });
  }

  await Promise.all(affectedCircleIds.map((id) => rebroadcastCircle(io, id)));

  ack({ ok: true, data: null });
};
