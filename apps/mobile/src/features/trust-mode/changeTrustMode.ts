import type { TrustMode } from '@haven/contracts';

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
  if (!DEMO_MODE) await requestTrustMode(mode);
  sessionActions().trustModeConfirmed(mode);
};
