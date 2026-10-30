import {
  EARTH_RADIUS_M,
  quantiseBattery,
  type Activity,
  type BatteryContext,
  type Coordinate,
  type LocationReport,
  type MemberPresence,
  type UploadPolicy,
} from '@haven/contracts';

/**
 * Turning an OS location fix into a report, and deciding whether it is worth
 * sending. Pure, and tested (test/location.test.ts): this is the code that
 * decides how often a phone wakes its radio.
 */

/** The fields of an expo-location fix that a report uses. */
export interface Fix {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

/**
 * What the server assumes until it has said otherwise. Five minutes and
 * 150 m is the 'unknown' row of the policy table (docs/02 §4), so the
 * first report goes out promptly and the server tunes from there.
 */
export const DEFAULT_POLICY: UploadPolicy = {
  intervalMs: 5 * 60_000,
  distanceFilterM: 150,
  idle: false,
};

/**
 * Activity from speed alone, as a stand-in until motion activity is wired.
 * It only feeds the upload cadence, and it errs towards the faster cadence
 * for anything quicker than walking. Running and cycling overlap too much
 * by speed to tell apart, and share a cadence anyway, so 'running' is never
 * guessed. Above 25 km/h it is a car or a motorbike either way.
 */
export const inferActivity = (speedMps: number | null | undefined): Activity => {
  if (speedMps === null || speedMps === undefined || speedMps < 0) return 'unknown';
  if (speedMps < 0.4) return 'still';
  if (speedMps < 2.5) return 'walking';
  if (speedMps < 7) return 'cycling';
  return 'driving';
};

/** expo-battery's power state, as the contract wants it. */
export const toBatteryContext = (power: {
  batteryLevel: number;
  /** expo-battery's enum: 0 unknown, 1 unplugged, 2 charging, 3 full. */
  batteryState: number;
  lowPowerMode: boolean;
}): BatteryContext => {
  const state =
    (['unknown', 'unplugged', 'charging', 'full'] as const)[power.batteryState] ?? 'unknown';
  // Only simulators report no level (-1). The contract has no "unknown
  // percent", so they show as full with an unknown state rather than as
  // an alarming empty ring.
  const percent = power.batteryLevel < 0 ? 100 : quantiseBattery(power.batteryLevel * 100);
  return { percent, state, powerSaving: power.lowPowerMode };
};

export const buildReport = (args: {
  fix: Fix;
  battery: BatteryContext;
  timezone: string;
}): LocationReport => {
  const { coords, timestamp } = args.fix;
  return {
    // [lon, lat]: GeoJSON order, as everywhere on the wire.
    coordinate: [coords.longitude, coords.latitude],
    // An OS that will not say how accurate a fix is gets treated as coarse.
    accuracyM: Math.min(10_000, Math.max(0, coords.accuracy ?? 100)),
    ...(coords.altitude !== null ? { altitudeM: coords.altitude } : {}),
    ...(coords.heading !== null && coords.heading >= 0 && coords.heading <= 360
      ? { headingDeg: coords.heading }
      : {}),
    ...(coords.speed !== null && coords.speed >= 0 ? { speedMps: coords.speed } : {}),
    activity: inferActivity(coords.speed),
    battery: args.battery,
    timezone: args.timezone,
    capturedAt: new Date(timestamp).toISOString(),
  };
};

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export const distanceM = ([lon1, lat1]: Coordinate, [lon2, lat2]: Coordinate): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

export interface Sent {
  at: number;
  coordinate: Coordinate;
}

/**
 * Send when the server's interval has passed, or when the phone has moved
 * further than its distance filter, whichever comes first. The OS delivers
 * fixes more often than that (it cannot do time intervals on iOS at all),
 * so this is where the server's policy is actually enforced.
 */
export const shouldUpload = (last: Sent | null, next: Sent, policy: UploadPolicy): boolean => {
  if (!last) return true;
  if (next.at - last.at >= policy.intervalMs) return true;
  return distanceM(last.coordinate, next.coordinate) >= Math.max(1, policy.distanceFilterM);
};

/**
 * The sender's own avatar, updated from its own fix. The server never echoes
 * a report back to the socket that sent it, so without this "You" would sit
 * still while everyone else saw you move. Weather is the server's to say, so
 * whatever it last said is kept.
 */
export const selfPresence = (
  userId: string,
  report: LocationReport,
  previous: MemberPresence | undefined,
): MemberPresence => ({
  userId,
  trustMode: 'precise',
  coordinate: report.coordinate,
  radiusM: report.accuracyM,
  battery: report.battery,
  timezone: report.timezone,
  activity: report.activity,
  online: true,
  capturedAt: report.capturedAt,
  ...(previous?.weather ? { weather: previous.weather } : {}),
});

/** Restart OS updates only when the policy changes what we ask the OS for. */
export const policyChanged = (a: UploadPolicy, b: UploadPolicy): boolean =>
  a.intervalMs !== b.intervalMs || a.distanceFilterM !== b.distanceFilterM || a.idle !== b.idle;
