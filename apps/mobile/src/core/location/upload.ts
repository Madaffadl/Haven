import {
  routes,
  uploadPolicySchema,
  type LocationReport,
  type UploadPolicy,
} from '@haven/contracts';
import * as Battery from 'expo-battery';

import { DEMO_CIRCLE_ID, DEMO_SELF_ID } from '../../dev/demoCircle';
import { DEMO_MODE } from '../../dev/demoMode';
import { usePresence } from '../../state/presence';
import { useSession } from '../../state/session';
import { api } from '../api';
import { getSocket, requestLocationReport } from '../realtime/socket';
import {
  DEFAULT_POLICY,
  buildReport,
  policyChanged,
  selfPresence,
  shouldUpload,
  toBatteryContext,
  type Fix,
  type Sent,
} from './reportModel';

/**
 * Every location fix, foreground or background, comes through `handleFix`.
 *
 * It does two things. It moves your own avatar right away, and it sends a
 * report when the server's policy says one is due (reportModel.shouldUpload).
 * The policy in each response decides the next cadence, and a changed
 * policy restarts OS updates with the new filters (tracker.ts).
 *
 * Over the socket when one is open, and over HTTPS otherwise. That is the
 * rule the server's change suppression relies on (handlers/location.ts):
 * while a socket is alive every report goes through it.
 *
 * Nothing here needs the signed-in UI to exist. A background relaunch can
 * run this before any screen has rendered; the upload only needs the stored
 * tokens, and the avatar update is skipped when nobody is signed in on
 * screen.
 */

let policy: UploadPolicy = DEFAULT_POLICY;
let lastSent: Sent | null = null;
let held = false;
let policyListener: ((next: UploadPolicy) => void) | null = null;

export const currentPolicy = (): UploadPolicy => policy;

/** tracker.ts restarts OS updates through this when the cadence changes. */
export const onPolicyChange = (listener: ((next: UploadPolicy) => void) | null): void => {
  policyListener = listener;
};

/**
 * Held while a Trust Mode change is in flight (features/trust-mode). A report
 * that lands mid-change would be fanned out under the mode the user is in the
 * middle of leaving.
 */
export const setUploadsHeld = (value: boolean): void => {
  held = value;
};

/** Forget the last send, e.g. on sign-out, so the next account starts clean. */
export const resetUploads = (): void => {
  policy = DEFAULT_POLICY;
  lastSent = null;
};

const readBattery = async () => {
  try {
    return toBatteryContext(await Battery.getPowerStateAsync());
  } catch {
    return toBatteryContext({ batteryLevel: -1, batteryState: 0, lowPowerMode: false });
  }
};

/** Your own avatar, in every circle on this device's map. */
const moveSelf = (report: LocationReport): void => {
  const session = useSession.getState();
  const selfId = DEMO_MODE ? DEMO_SELF_ID : session.me?.userId;
  if (!selfId) return;

  const circleIds = DEMO_MODE ? [DEMO_CIRCLE_ID] : session.circles.map((c) => c.id);
  const presence = usePresence.getState();
  for (const circleId of circleIds) {
    const previous = presence.circles[circleId]?.members[selfId];
    presence.actions.update({ circleId, member: selfPresence(selfId, report, previous) });
  }
};

const send = (report: LocationReport): Promise<UploadPolicy> =>
  getSocket()?.connected
    ? requestLocationReport(report)
    : api.request(routes.location, { method: 'POST', body: report }, uploadPolicySchema);

export const handleFix = async (fix: Fix): Promise<void> => {
  const report = buildReport({
    fix,
    battery: await readBattery(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  moveSelf(report);

  // The demo circle has no server to tell.
  if (DEMO_MODE || held) return;

  const next: Sent = { at: fix.timestamp, coordinate: report.coordinate };
  if (!shouldUpload(lastSent, next, policy)) return;

  try {
    const nextPolicy = await send(report);
    lastSent = next;
    const changed = policyChanged(policy, nextPolicy);
    policy = nextPolicy;
    if (changed) policyListener?.(nextPolicy);
  } catch {
    // Offline, signed out or rate limited: there is nobody to tell from a
    // background task, and lastSent is unchanged, so the next fix retries.
  }
};
