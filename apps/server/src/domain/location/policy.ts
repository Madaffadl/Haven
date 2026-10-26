import type { Activity, UploadPolicy } from '@haven/contracts';

/**
 * Server-driven upload cadence.
 *
 * The client does not choose its own interval. Only the server knows whether
 * anyone is actually watching this member's map, and "nobody has the app open"
 * is by far the strongest argument for backing off — it is the difference
 * between a background app that costs 2% a day and one that costs 15% and
 * gets deleted. A location app whose own battery indicator is the thing
 * draining the battery is a bad joke.
 *
 * Pure function so the cadence table is unit-testable and reviewable in one
 * place rather than scattered across the client.
 */

const BASE_INTERVAL_MS: Record<Activity, number> = {
  unknown: 5 * 60_000,
  still: 10 * 60_000,
  walking: 2 * 60_000,
  running: 60_000,
  cycling: 60_000,
  // Driving is the one case where coarse sampling is visibly wrong: at
  // 100 km/h a 2-minute gap is 3.3 km of missing road.
  driving: 30_000,
};

const DISTANCE_FILTER_M: Record<Activity, number> = {
  unknown: 150,
  still: 150,
  walking: 75,
  running: 100,
  cycling: 150,
  driving: 400,
};

const MIN_INTERVAL_MS = 15_000;
const MAX_INTERVAL_MS = 30 * 60_000;

/** Nobody is looking: the cheapest cadence that still keeps context alive. */
const IDLE_INTERVAL_MS = 15 * 60_000;

export interface PolicyInput {
  activity: Activity;
  batteryPercent: number | null;
  powerSaving: boolean;
  /** Does any other member of any shared circle currently have a live socket? */
  hasLiveViewers: boolean;
  /**
   * True while the member is 'ghost' in every circle they belong to. Nobody
   * can see their position, so paying for GPS at all is pure waste.
   */
  fullyGhosted: boolean;
}

export const resolveUploadPolicy = (input: PolicyInput): UploadPolicy => {
  const { activity, batteryPercent, powerSaving, hasLiveViewers, fullyGhosted } = input;

  if (fullyGhosted) {
    return { intervalMs: MAX_INTERVAL_MS, distanceFilterM: 2000, idle: true };
  }

  let intervalMs = hasLiveViewers
    ? BASE_INTERVAL_MS[activity]
    : Math.max(BASE_INTERVAL_MS[activity], IDLE_INTERVAL_MS);

  // Low battery and Low Power Mode both halve the cadence. They compound on
  // purpose: a phone at 12% in Low Power Mode needs every milliamp more than
  // the map needs a fresh dot.
  if (powerSaving) intervalMs *= 2;
  if (batteryPercent !== null && batteryPercent <= 20) intervalMs *= 2;
  if (batteryPercent !== null && batteryPercent <= 10) intervalMs *= 2;

  const clamped = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(intervalMs)));

  return {
    intervalMs: clamped,
    distanceFilterM: DISTANCE_FILTER_M[activity],
    idle: !hasLiveViewers,
  };
};
