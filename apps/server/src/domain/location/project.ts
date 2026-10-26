import type {
  Activity,
  BatteryContext,
  Coordinate,
  MemberPresence,
  TrustMode,
  WeatherContext,
} from '@haven/contracts';
import { quantiseBattery } from '@haven/contracts';
import type { FuzzAnchor } from './fuzz.js';

/**
 * Turns stored truth into the single payload a circle is allowed to see.
 *
 * The important property is structural: for a non-'precise' member, the real
 * coordinate is never written into the returned object. It is not redacted
 * later, not omitted by a serialiser, not filtered by a middleware — it never
 * enters the value at all. Every downstream consumer (socket fan-out, push
 * payload, widget response, logs) is therefore safe by construction rather
 * than by discipline.
 */

/** Anything older than this is "we've lost them", not "they haven't moved". */
export const STALE_AFTER_MS = 20 * 60 * 1000;

/** Floor on the broadcast accuracy ring; a 1 m ring renders as a dot. */
const MIN_PRECISE_RADIUS_M = 5;

export interface SubjectState {
  userId: string;
  precise: Coordinate | null;
  accuracyM: number;
  activity: Activity;
  battery: BatteryContext | null;
  weather: WeatherContext | null;
  timezone: string | null;
  capturedAt: Date | null;
}

export interface ProjectionInput {
  subject: SubjectState;
  mode: TrustMode;
  /** Required for 'approximate'. Absent means fail closed. */
  anchor: FuzzAnchor | null;
  online: boolean;
}

/**
 * Resolve the coordinate + radius pair for a given Trust Mode.
 *
 * 'approximate' with no anchor yields nothing. That is deliberate: the only
 * other option is falling back to the precise point, which would turn a
 * missing cache row into a location leak. Showing a member as "location
 * unavailable" for one update cycle is the correct failure.
 */
const projectPosition = (
  input: ProjectionInput,
): { coordinate: Coordinate; radiusM: number } | null => {
  const { subject, mode, anchor } = input;

  switch (mode) {
    case 'precise':
      return subject.precise
        ? {
            coordinate: subject.precise,
            radiusM: Math.max(subject.accuracyM, MIN_PRECISE_RADIUS_M),
          }
        : null;

    case 'approximate':
      return anchor ? { coordinate: anchor.centroid, radiusM: anchor.radiusM } : null;

    case 'ghost':
      return null;
  }
};

export const projectPresence = (input: ProjectionInput): MemberPresence => {
  const { subject, mode, online } = input;
  const position = projectPosition(input);

  return {
    userId: subject.userId,
    trustMode: mode,
    activity: subject.activity,
    online,
    ...(position ? { coordinate: position.coordinate, radiusM: position.radiusM } : {}),
    ...(subject.battery
      ? { battery: { ...subject.battery, percent: quantiseBattery(subject.battery.percent) } }
      : {}),
    ...(subject.weather ? { weather: subject.weather } : {}),
    // Timezone is withheld in 'ghost': "it's 3am there" is a coarse location
    // signal, and a member who chose to hide their position did not agree to
    // disclose their longitude by the back door.
    ...(subject.timezone && mode !== 'ghost' ? { timezone: subject.timezone } : {}),
    ...(subject.capturedAt ? { capturedAt: subject.capturedAt.toISOString() } : {}),
  };
};

export const isStale = (capturedAt: Date | null, now: Date): boolean =>
  capturedAt === null || now.getTime() - capturedAt.getTime() > STALE_AFTER_MS;

// ---------------------------------------------------------------------------
// Broadcast suppression
// ---------------------------------------------------------------------------

/**
 * Whether a new projection is worth a packet to every member of a circle.
 *
 * This is the single largest lever on fan-out cost, and it falls out of the
 * privacy design for free: a member in 'approximate' mode who is sitting at
 * home produces the *same cell centroid* on every report, so comparing
 * projections — rather than raw inputs — suppresses the broadcast entirely.
 * A stationary fuzzy household generates near-zero realtime traffic.
 *
 * Battery is compared post-quantisation (5% buckets), so ordinary discharge
 * wakes every recipient's radio roughly once per 5% rather than once per
 * report.
 */
export const hasMaterialChange = (
  previous: MemberPresence | null,
  next: MemberPresence,
): boolean => {
  if (!previous) return true;

  if (previous.trustMode !== next.trustMode) return true;
  if (previous.online !== next.online) return true;
  if (previous.activity !== next.activity) return true;

  const hadPosition = previous.coordinate !== undefined;
  const hasPosition = next.coordinate !== undefined;
  if (hadPosition !== hasPosition) return true;

  if (previous.coordinate && next.coordinate) {
    // Sub-metre differences are GPS noise, not movement. ~1e-5 deg ≈ 1.1 m.
    const moved =
      Math.abs(previous.coordinate[0] - next.coordinate[0]) > 1e-5 ||
      Math.abs(previous.coordinate[1] - next.coordinate[1]) > 1e-5;
    if (moved) return true;
    if (Math.abs((previous.radiusM ?? 0) - (next.radiusM ?? 0)) > 1) return true;
  }

  if (previous.battery?.percent !== next.battery?.percent) return true;
  if (previous.battery?.state !== next.battery?.state) return true;
  if (previous.battery?.powerSaving !== next.battery?.powerSaving) return true;

  if (previous.weather?.code !== next.weather?.code) return true;
  if (Math.abs((previous.weather?.temperatureC ?? 0) - (next.weather?.temperatureC ?? 0)) >= 1) {
    return true;
  }

  // A member crossing into "stale" is a visible UI change even though no
  // field moved, so the staleness boundary must be checked by the caller
  // against wall-clock time — see handlers/presence.ts.
  return false;
};
