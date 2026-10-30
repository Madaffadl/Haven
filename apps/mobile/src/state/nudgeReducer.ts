import type { NudgeEvent, NudgeKind } from '@haven/contracts';

/**
 * Nudge moments waiting to play on screen, as pure transitions.
 *
 * A moment is one thing the overlay shows: a nudge someone sent you, the
 * burst confirming one you sent, or the quiet "saw your heart" when they
 * rendered it. They play one at a time, in order, so three hearts arriving
 * together read as three hearts and not as one glitch.
 */

export type NudgeMoment =
  | {
      id: string;
      type: 'received';
      kind: NudgeKind;
      circleId: string;
      fromUserId: string;
      nudgeId: string;
    }
  | { id: string; type: 'sent'; kind: NudgeKind; circleId: string; toUserId?: string }
  | { id: string; type: 'seen'; kind: NudgeKind; circleId: string; byUserId: string };

interface SentNudge {
  kind: NudgeKind;
  circleId: string;
  toUserId?: string;
}

export interface NudgeState {
  queue: NudgeMoment[];
  /**
   * Ids already queued, newest last. A reconnect can replay events the
   * client already saw, and the same heart bursting twice looks broken.
   */
  recentIds: string[];
  /** Direct nudges this device sent, until their "seen" arrives. */
  sent: Record<string, SentNudge>;
}

export const emptyNudges: NudgeState = { queue: [], recentIds: [], sent: {} };

/** Beyond this, a backlog is dropped rather than played for a minute. */
export const MAX_QUEUE = 6;
const MAX_RECENT = 50;

const enqueue = (state: NudgeState, moment: NudgeMoment): NudgeState => {
  if (state.recentIds.includes(moment.id) || state.queue.length >= MAX_QUEUE) return state;
  return {
    ...state,
    queue: [...state.queue, moment],
    recentIds: [...state.recentIds, moment.id].slice(-MAX_RECENT),
  };
};

export const applyReceived = (state: NudgeState, event: NudgeEvent): NudgeState =>
  enqueue(state, {
    id: `received:${event.id}`,
    type: 'received',
    kind: event.kind,
    circleId: event.circleId,
    fromUserId: event.fromUserId,
    nudgeId: event.id,
  });

export const applySent = (
  state: NudgeState,
  args: { nudgeId: string; kind: NudgeKind; circleId: string; toUserId?: string },
): NudgeState => {
  const { nudgeId, ...nudge } = args;
  const next = enqueue(state, { id: `sent:${nudgeId}`, type: 'sent', ...nudge });
  // Only direct nudges get a "seen": a circle-wide one would come back once
  // per member, which is a stream of notices rather than a moment.
  return nudge.toUserId ? { ...next, sent: { ...next.sent, [nudgeId]: nudge } } : next;
};

export const applyDelivered = (state: NudgeState, payload: { nudgeId: string }): NudgeState => {
  const original = state.sent[payload.nudgeId];
  // Unknown here: sent from another of this user's devices, or a circle nudge.
  if (!original?.toUserId) return state;

  const { [payload.nudgeId]: _delivered, ...sent } = state.sent;
  return enqueue(
    { ...state, sent },
    {
      id: `seen:${payload.nudgeId}`,
      type: 'seen',
      kind: original.kind,
      circleId: original.circleId,
      byUserId: original.toUserId,
    },
  );
};

/** The moment at the head of the queue has finished playing. */
export const applyShown = (state: NudgeState): NudgeState => ({
  ...state,
  queue: state.queue.slice(1),
});
