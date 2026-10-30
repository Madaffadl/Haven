import {
  NUDGE_RATE_LIMIT,
  nudgeAckSchema,
  sendNudgeSchema,
  userRoom,
  type Ack,
  type NudgeEvent,
} from '@haven/contracts';

import { getLiveMemberIds, isMember } from '../../infra/db/repositories/circle.js';
import { ackNudge, mutedRecipients, recordNudge } from '../../infra/db/repositories/nudge.js';
import { logPushSender } from '../../infra/push/index.js';
import { onlineStatuses } from '../../infra/redis/presence.js';
import { limitNudgeFromSender, limitNudgeToRecipient } from '../../infra/redis/rateLimit.js';
import { logger } from '../../lib/logger.js';
import type { HandlerContext } from '../types.js';

/**
 * Tap-to-Nudge.
 *
 *   validate → authorise → rate-limit → persist (idempotent) → deliver
 *
 * Delivery is dual-path by necessity: emit to any live socket, and push to
 * anyone without one. Those are not fallbacks for each other so much as two
 * halves of the same send — a phone in a pocket has no socket, and that is
 * the normal case for this feature.
 *
 * Rate limiting sits *before* persistence so a flood costs one Redis INCR
 * rather than a row.
 */

export const handleSendNudge = async (
  ctx: HandlerContext,
  raw: unknown,
  ack: Ack<{ id: string; sentAt: string }>,
): Promise<void> => {
  const { io, socket } = ctx;
  const fromUserId = socket.data.userId;

  const parsed = sendNudgeSchema.safeParse(raw);
  if (!parsed.success) {
    ack({ ok: false, error: { code: 'invalid_payload', message: 'malformed nudge' } });
    return;
  }
  const { circleId, toUserId, kind, clientNudgeId } = parsed.data;

  // Membership is re-checked rather than trusted from the cached socket data:
  // being removed from a circle must stop nudges immediately, not at the next
  // reconnect.
  if (!(await isMember(fromUserId, circleId))) {
    ack({ ok: false, error: { code: 'not_a_member', message: 'not a member of this circle' } });
    return;
  }

  if (toUserId && !(await isMember(toUserId, circleId))) {
    ack({ ok: false, error: { code: 'forbidden', message: 'recipient is not in this circle' } });
    return;
  }

  const senderLimit = await limitNudgeFromSender(fromUserId, NUDGE_RATE_LIMIT.perSenderPerMinute);
  if (!senderLimit.allowed) {
    ack({
      ok: false,
      error: { code: 'rate_limited', message: 'slow down', retryAfterMs: senderLimit.retryAfterMs },
    });
    return;
  }

  if (toUserId) {
    const recipientLimit = await limitNudgeToRecipient(
      fromUserId,
      toUserId,
      NUDGE_RATE_LIMIT.perRecipientPerMinute,
    );
    if (!recipientLimit.allowed) {
      // Deliberately indistinguishable from the sender limit. Telling a sender
      // "you have hit this person's limit" turns a protection into a signal
      // the sender can act on, which is the opposite of what it is for.
      ack({
        ok: false,
        error: {
          code: 'rate_limited',
          message: 'slow down',
          retryAfterMs: recipientLimit.retryAfterMs,
        },
      });
      return;
    }
  }

  const stored = await recordNudge({
    circleId,
    fromUserId,
    toUserId: toUserId ?? null,
    kind,
    clientNudgeId,
  });

  const event: NudgeEvent = {
    id: stored.id,
    circleId,
    fromUserId,
    kind,
    sentAt: stored.sentAt.toISOString(),
    ...(toUserId ? { toUserId } : {}),
  };

  // A retry of an already-recorded nudge is acknowledged with the original
  // id and timestamp, and delivered to nobody. The recipient already saw it.
  if (!stored.created) {
    ack({ ok: true, data: { id: stored.id, sentAt: stored.sentAt.toISOString() } });
    return;
  }

  const allRecipients = toUserId
    ? [toUserId]
    : (await getLiveMemberIds(circleId)).filter((id) => id !== fromUserId);

  const muted = await mutedRecipients({ circleId, userIds: allRecipients });
  const recipients = allRecipients.filter((id) => !muted.has(id));

  // Addressed per recipient, never to the circle room, so a mute holds for
  // live sockets too: a muted member must not get the buzz just because
  // their app happens to be open. The guard matters: Socket.IO treats an
  // empty room list as "no filter" and would broadcast to every socket.
  if (recipients.length > 0) {
    io.to(recipients.map(userRoom)).emit('nudge:received', event);
  }

  // Push anyone who has no live socket. Muted members are already filtered,
  // so a mute silences the push as well as the buzz.
  const online = await onlineStatuses(recipients);
  const offline = recipients.filter((id) => !online.get(id));

  await Promise.all(
    offline.map((userId) =>
      logPushSender
        .sendNudge({
          userId,
          fromDisplayName: '',
          kind,
          nudgeId: stored.id,
        })
        .catch((error: unknown) => {
          logger.warn({ err: error, userId }, 'nudge push failed');
        }),
    ),
  );

  ack({ ok: true, data: { id: stored.id, sentAt: stored.sentAt.toISOString() } });
};

/**
 * The recipient's client confirms it actually rendered the animation.
 *
 * This, not push receipt, is what lights up the sender's "seen" state. A push
 * delivered to a phone face-down in a bag is not someone seeing your heart,
 * and showing it as such would manufacture exactly the false intimacy this
 * product is supposed to avoid.
 */
export const handleNudgeAck = async (
  ctx: HandlerContext,
  raw: unknown,
  ack: Ack<null>,
): Promise<void> => {
  const { io, socket } = ctx;

  const parsed = nudgeAckSchema.safeParse(raw);
  if (!parsed.success) {
    ack({ ok: false, error: { code: 'invalid_payload', message: 'malformed ack' } });
    return;
  }

  const result = await ackNudge({
    nudgeId: parsed.data.nudgeId,
    recipientId: socket.data.userId,
  });

  // Null means it was already acked (a duplicate ack from a retrying client),
  // so the sender has been told once and must not be told again.
  if (result) {
    io.to(userRoom(result.fromUserId)).emit('nudge:delivered', {
      nudgeId: parsed.data.nudgeId,
      at: result.ackedAt.toISOString(),
    });
  }

  ack({ ok: true, data: null });
};
