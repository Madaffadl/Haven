import type { NudgeKind } from '@haven/contracts';

import { requestNudge } from '../../core/realtime/socket';
import { DEMO_MODE } from '../../dev/demoMode';
import { uuidv7 } from '../../lib/uuidv7';
import { nudgeActions } from '../../state/nudges';
import { usePresence } from '../../state/presence';
import { DEMO_REPLY } from './nudgeCopy';

/** Long enough to read as a reply rather than an echo. */
const DEMO_REPLY_MS = 1_800;

/**
 * Send a nudge and play its burst on the sender's screen once the server has
 * it, so the burst means "sent" and not just "tapped".
 *
 * The client id is the idempotency key: a retry after a dropped ack gets the
 * original nudge back instead of a second heart on the recipient's screen.
 *
 * In demo mode there is no server. The burst plays straight away, and any
 * online member of the sample circle answers, so receiving can be seen too.
 */
export const sendNudge = async (args: {
  circleId: string;
  toUserId: string;
  kind: NudgeKind;
}): Promise<void> => {
  const clientNudgeId = uuidv7();

  if (DEMO_MODE) {
    nudgeActions().sent({ nudgeId: clientNudgeId, ...args });
    scheduleDemoReply(args);
    return;
  }

  const { id } = await requestNudge({ ...args, clientNudgeId });
  nudgeActions().sent({ nudgeId: id, ...args });
};

const scheduleDemoReply = (args: { circleId: string; toUserId: string; kind: NudgeKind }) => {
  setTimeout(() => {
    const member = usePresence.getState().circles[args.circleId]?.members[args.toUserId];
    // Offline people don't answer, in the demo or anywhere else.
    if (!member?.online) return;

    nudgeActions().received({
      id: uuidv7(),
      circleId: args.circleId,
      fromUserId: args.toUserId,
      kind: DEMO_REPLY[args.kind],
      sentAt: new Date().toISOString(),
    });
  }, DEMO_REPLY_MS);
};
