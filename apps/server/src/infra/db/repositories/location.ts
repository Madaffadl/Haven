import type { Coordinate, LocationReport, TrustMode } from '@haven/contracts';
import type { FuzzAnchor } from '../../../domain/location/fuzz.js';
import { pool } from '../pool.js';

export interface MembershipContext {
  circleId: string;
  mode: TrustMode;
  fuzzRadiusM: number;
  anchor: FuzzAnchor | null;
}

export interface StoredContext {
  capturedAt: Date;
  weatherCode: number | null;
  weatherTempC: number | null;
  weatherIsDay: boolean | null;
  weatherObservedAt: Date | null;
}

/**
 * Persist a fix.
 *
 * The `WHERE ... captured_at < EXCLUDED.captured_at` guard on the upsert is
 * the important line. Reports arrive out of order constantly — a phone that
 * regains signal flushes a queue of deferred fixes, and the newest is not
 * necessarily last through the socket. Without the guard a stale fix
 * overwrites a fresh one and the avatar jumps backwards in time.
 *
 * Returning no row means "this report was older than what we already have",
 * which the handler treats as a successful no-op rather than an error.
 */
export const upsertLocationState = async (args: {
  userId: string;
  deviceId: string;
  report: LocationReport;
}): Promise<StoredContext | null> => {
  const { userId, deviceId, report } = args;
  const [lon, lat] = report.coordinate;

  const { rows } = await pool.query<StoredContext>(
    `
    INSERT INTO location_states (
      user_id, device_id, geom, accuracy_m, altitude_m, heading_deg, speed_mps,
      activity, battery_percent, battery_state, power_saving, timezone, captured_at
    )
    VALUES (
      $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
      $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
    )
    ON CONFLICT (user_id) DO UPDATE SET
      device_id       = EXCLUDED.device_id,
      geom            = EXCLUDED.geom,
      accuracy_m      = EXCLUDED.accuracy_m,
      altitude_m      = EXCLUDED.altitude_m,
      heading_deg     = EXCLUDED.heading_deg,
      speed_mps       = EXCLUDED.speed_mps,
      activity        = EXCLUDED.activity,
      battery_percent = EXCLUDED.battery_percent,
      battery_state   = EXCLUDED.battery_state,
      power_saving    = EXCLUDED.power_saving,
      timezone        = EXCLUDED.timezone,
      captured_at     = EXCLUDED.captured_at,
      received_at     = now()
    WHERE location_states.captured_at < EXCLUDED.captured_at
    RETURNING
      captured_at          AS "capturedAt",
      weather_code         AS "weatherCode",
      weather_temp_c       AS "weatherTempC",
      weather_is_day       AS "weatherIsDay",
      weather_observed_at  AS "weatherObservedAt"
    `,
    [
      userId,
      deviceId,
      lon,
      lat,
      report.accuracyM,
      report.altitudeM ?? null,
      report.headingDeg ?? null,
      report.speedMps ?? null,
      report.activity,
      report.battery.percent,
      report.battery.state,
      report.battery.powerSaving,
      report.timezone,
      report.capturedAt,
    ],
  );

  return rows[0] ?? null;
};

/**
 * History is opt-in, and the opt-in is enforced here in SQL rather than in a
 * caller's `if`. One `WHERE EXISTS` is harder to forget than a branch that
 * every future write path has to remember to repeat.
 */
export const appendHistory = async (args: {
  userId: string;
  report: LocationReport;
}): Promise<void> => {
  const [lon, lat] = args.report.coordinate;
  await pool.query(
    `
    INSERT INTO location_history (user_id, geom, accuracy_m, activity, battery_percent, captured_at)
    SELECT $1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7
    WHERE EXISTS (SELECT 1 FROM users WHERE id = $1 AND history_enabled)
    `,
    [
      args.userId,
      lon,
      lat,
      args.report.accuracyM,
      args.report.activity,
      args.report.battery.percent,
      args.report.capturedAt,
    ],
  );
};

/**
 * Everything the broadcast path needs about one member, in a single query:
 * which circles they are in, how private they are in each, and the fuzz
 * anchor currently published to each.
 *
 * Read once on connect and cached on the socket. Re-reading per location
 * report would mean a join per report per member — the hottest query in the
 * system doing work that changes only when someone taps the privacy toggle.
 */
export const getMembershipContext = async (userId: string): Promise<MembershipContext[]> => {
  const { rows } = await pool.query<{
    circleId: string;
    mode: TrustMode;
    fuzzRadiusM: number;
    cellKey: string | null;
    phaseSalt: string | null;
    anchorRadiusM: number | null;
    anchorLon: number | null;
    anchorLat: number | null;
  }>(
    `
    SELECT
      m.circle_id                               AS "circleId",
      haven_resolve_trust_mode(m.user_id, m.circle_id) AS "mode",
      COALESCE(t.fuzz_radius_m, 1000)           AS "fuzzRadiusM",
      a.cell_key                                AS "cellKey",
      a.phase_salt                              AS "phaseSalt",
      a.radius_m                                AS "anchorRadiusM",
      ST_X(a.geom::geometry)                    AS "anchorLon",
      ST_Y(a.geom::geometry)                    AS "anchorLat"
    FROM circle_members m
    LEFT JOIN circle_member_trust t
           ON t.circle_id = m.circle_id AND t.user_id = m.user_id
    LEFT JOIN location_fuzz_anchors a
           ON a.circle_id = m.circle_id AND a.user_id = m.user_id
    WHERE m.user_id = $1 AND m.left_at IS NULL
    `,
    [userId],
  );

  return rows.map((row) => ({
    circleId: row.circleId,
    mode: row.mode,
    fuzzRadiusM: row.fuzzRadiusM,
    anchor:
      row.cellKey !== null &&
      row.phaseSalt !== null &&
      row.anchorRadiusM !== null &&
      row.anchorLon !== null &&
      row.anchorLat !== null
        ? {
            cellKey: row.cellKey,
            phaseSalt: row.phaseSalt,
            radiusM: row.anchorRadiusM,
            centroid: [row.anchorLon, row.anchorLat] as Coordinate,
          }
        : null,
  }));
};

export const upsertAnchor = async (args: {
  userId: string;
  circleId: string;
  anchor: FuzzAnchor;
}): Promise<void> => {
  const [lon, lat] = args.anchor.centroid;
  await pool.query(
    `
    INSERT INTO location_fuzz_anchors
      (user_id, circle_id, radius_m, geom, cell_key, phase_salt, resolved_at)
    VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, now())
    ON CONFLICT (user_id, circle_id) DO UPDATE SET
      radius_m    = EXCLUDED.radius_m,
      geom        = EXCLUDED.geom,
      cell_key    = EXCLUDED.cell_key,
      phase_salt  = EXCLUDED.phase_salt,
      resolved_at = now()
    `,
    [
      args.userId,
      args.circleId,
      args.anchor.radiusM,
      lon,
      lat,
      args.anchor.cellKey,
      args.anchor.phaseSalt,
    ],
  );
};

/**
 * Seed an anchor from the member's last known position when they switch a
 * circle to Approximate.
 *
 * Done entirely in SQL on purpose. The projection fails closed when no anchor
 * exists, so without this the member would show as "location unavailable"
 * until their next scheduled report — up to ten minutes of looking broken
 * immediately after tapping a privacy control, which reads as "the toggle
 * lost my location".
 *
 * Note that `geom` never enters the Node process: `haven_cell()` consumes and
 * produces it inside the database, so this path stays compatible with
 * revoking SELECT on the column (see migration 0008).
 */
export const seedAnchorFromCurrentPosition = async (args: {
  userId: string;
  circleId: string;
  radiusM: number;
  phaseSalt: string;
}): Promise<void> => {
  await pool.query(
    `
    INSERT INTO location_fuzz_anchors
      (user_id, circle_id, radius_m, geom, cell_key, phase_salt, resolved_at)
    SELECT
      s.user_id, $2, $3,
      (haven_cell(s.geom, $3, $4)).centroid,
      (haven_cell(s.geom, $3, $4)).cell_key,
      $4, now()
    FROM location_states s
    WHERE s.user_id = $1
    ON CONFLICT (user_id, circle_id) DO UPDATE SET
      radius_m    = EXCLUDED.radius_m,
      geom        = EXCLUDED.geom,
      cell_key    = EXCLUDED.cell_key,
      phase_salt  = EXCLUDED.phase_salt,
      resolved_at = now()
    `,
    [args.userId, args.circleId, args.radiusM, args.phaseSalt],
  );
};
