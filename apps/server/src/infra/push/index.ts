import type { NudgeKind } from '@haven/contracts';
import { pool } from '../db/pool.js';
import { logger } from '../../lib/logger.js';

/**
 * Push fallback.
 *
 * Most nudges are delivered to a closed socket, because most of the time the
 * recipient's phone is asleep — so push is the primary delivery path in
 * practice, not the exception. The socket is the optimisation.
 *
 * Deliberately a narrow interface: APNs and FCM both need credentials this
 * repo does not carry, so the transport is injected. `logPushSender` is the
 * development implementation.
 */

export interface NudgePush {
  userId: string;
  fromDisplayName: string;
  kind: NudgeKind;
  nudgeId: string;
}

export interface PushSender {
  sendNudge(push: NudgePush): Promise<void>;
  /**
   * Silent push that tells a device to reload its widget timeline. Content-
   * available only — a visible alert every time a partner's battery ticks
   * down 5% would be intolerable.
   */
  reloadWidgets(userId: string): Promise<void>;
}

const tokensFor = async (userId: string): Promise<{ token: string; platform: string }[]> => {
  const { rows } = await pool.query<{ token: string; platform: string }>(
    `
    SELECT push_token AS token, platform::text AS platform
      FROM devices
     WHERE user_id = $1 AND revoked_at IS NULL AND push_token IS NOT NULL
    `,
    [userId],
  );
  return rows;
};

export const logPushSender: PushSender = {
  async sendNudge(push) {
    const devices = await tokensFor(push.userId);
    logger.info(
      { nudgeId: push.nudgeId, kind: push.kind, devices: devices.length },
      'would send nudge push',
    );
  },
  async reloadWidgets(userId) {
    const devices = await tokensFor(userId);
    logger.debug({ userId, devices: devices.length }, 'would request widget reload');
  },
};
