import type { UploadPolicy } from '@haven/contracts';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { color } from '../../ui/theme/tokens';
import type { LocationAccess } from './permissions';
import { currentPolicy, handleFix, onPolicyChange, resetUploads } from './upload';

/**
 * Asking the OS for fixes.
 *
 * With Always permission, one background task delivers every fix, whether
 * the app is open or not, so there is a single code path. With while-in-use
 * only, a foreground watch does the same job while Haven is on screen.
 *
 * The OS filters by distance (and, on Android, by time) using the server's
 * policy. The filters are coarse on purpose: Balanced accuracy lets iOS use
 * Wi-Fi and cell positioning instead of GPS, and when nobody is watching
 * (policy.idle) Low accuracy is enough. That is the battery budget of
 * docs/02 §4, applied at the source.
 */

export const LOCATION_TASK = 'haven.location';

// Must be defined at module load, before any task event can arrive. A
// background relaunch delivers the event as soon as the bundle runs, so
// this module is imported for its side effect from the root layout.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    // A deferred batch can hold several fixes; only the newest matters.
    const latest = data.locations[data.locations.length - 1];
    if (latest) await handleFix(latest);
  },
);

let watch: Location.LocationSubscription | null = null;

const filtersFor = (policy: UploadPolicy) => ({
  accuracy: policy.idle ? Location.Accuracy.Low : Location.Accuracy.Balanced,
  distanceInterval: policy.distanceFilterM,
  timeInterval: policy.intervalMs,
});

const stopUpdates = async (): Promise<void> => {
  watch?.remove();
  watch = null;
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
};

const startUpdates = async (access: LocationAccess, policy: UploadPolicy): Promise<void> => {
  await stopUpdates();

  if (access === 'always') {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...filtersFor(policy),
      // iOS batches fixes instead of waking per fix.
      deferredUpdatesInterval: policy.intervalMs,
      deferredUpdatesDistance: policy.distanceFilterM,
      // Automatic pausing stops updates until the app is next opened, which
      // would freeze someone on the map. The distance filter already keeps a
      // still phone quiet.
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: false,
      // Android requires a visible notification for background location.
      foregroundService: {
        notificationTitle: 'Haven',
        notificationBody: 'Sharing your location with your circle',
        notificationColor: color.background,
      },
    });
  } else if (access === 'when_in_use') {
    watch = await Location.watchPositionAsync(filtersFor(policy), (fix) => void handleFix(fix));
  }
};

/**
 * Starts and stops run one after another, never interleaved. A permission
 * prompt makes the app inactive and then active again, which re-checks
 * access while the first start may still be running; two interleaved starts
 * could each register a foreground watch and leak one.
 */
let queue: Promise<void> = Promise.resolve();
const serially = (step: () => Promise<void>): Promise<void> => {
  queue = queue.then(step, step);
  return queue;
};

/** Start (or restart) tracking for the access the OS has granted. */
export const startTracking = (access: LocationAccess): Promise<void> =>
  serially(async () => {
    onPolicyChange(
      (next) => void serially(() => startUpdates(access, next)).catch(() => undefined),
    );
    await startUpdates(access, currentPolicy());
  });

/** On sign-out: a signed-out phone must stop waking up to report. */
export const stopTracking = (): Promise<void> =>
  serially(async () => {
    onPolicyChange(null);
    resetUploads();
    await stopUpdates();
  });
