import type { TrustMode } from '@haven/contracts';

import { setUploadsHeld } from '../../core/location/upload';
import { requestTrustMode } from '../../core/realtime/socket';
import { DEMO_MODE } from '../../dev/demoMode';
import { sessionActions } from '../../state/session';

/**
 * Change what this user shares, everywhere.
 *
 * Not optimistic, on purpose: the stored mode only changes once the server
 * has acknowledged it. For most toggles optimistic UI feels faster; for this
 * one it would mean showing "Hidden" while the server is still broadcasting
 * a precise position.
 *
 * The demo has no server, so there the change is local and immediate.
 */
export const changeTrustMode = async (mode: TrustMode): Promise<void> => {
  if (!DEMO_MODE) {
    // Location reports wait until the server has the new mode, or a report
    // landing mid-change would be fanned out under the mode being left.
    setUploadsHeld(true);
    try {
      await requestTrustMode(mode);
    } finally {
      setUploadsHeld(false);
    }
  }
  sessionActions().trustModeConfirmed(mode);
};
