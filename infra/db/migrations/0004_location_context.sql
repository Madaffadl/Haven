-- 0004_location_context.sql
-- Live location + context state, the fuzzing anchors that make Approximate
-- mode actually private, and optional history.

-- ---------------------------------------------------------------------------
-- location_states — exactly one row per user, always the truth
-- ---------------------------------------------------------------------------
-- This table is UPDATE-heavy and read on every broadcast, so it is narrow and
-- carries its denormalised weather inline. Joining a weather table on every
-- fan-out would turn one cheap upsert into a join per recipient.
--
-- It stores the PRECISE fix regardless of Trust Mode. Fuzzing is a projection
-- applied at broadcast time (see 0005), not at storage time, because:
--   1. the user must always be able to see their own true position;
--   2. switching from Approximate back to Precise must be instant, with no
--      "we lost your real location while you were fuzzy" gap;
--   3. a client trusted to fuzz its own coordinates is a client that can be
--      patched to lie about them.
-- Access is therefore gated entirely in the application layer — nothing may
-- read this table except the projection code.
CREATE TABLE location_states (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  device_id      uuid REFERENCES devices (id) ON DELETE SET NULL,

  geom           geography(Point, 4326) NOT NULL,
  accuracy_m     real NOT NULL DEFAULT 0 CHECK (accuracy_m >= 0),
  altitude_m     real,
  heading_deg    real CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 360),
  speed_mps      real CHECK (speed_mps IS NULL OR speed_mps >= 0),
  activity       activity_kind NOT NULL DEFAULT 'unknown',

  -- Context: the reason this app exists.
  battery_percent smallint CHECK (battery_percent BETWEEN 0 AND 100),
  battery_state  battery_state NOT NULL DEFAULT 'unknown',
  power_saving   boolean NOT NULL DEFAULT false,

  -- IANA zone resolved on-device. Lets the UI say "11:40 PM there" without
  -- the server doing any timezone lookup from coordinates.
  timezone       text,

  -- Denormalised from weather_cache by the refresh job (0005).
  weather_code      smallint CHECK (weather_code BETWEEN 0 AND 99),
  weather_temp_c    real,
  weather_is_day    boolean,
  weather_observed_at timestamptz,

  -- When the GPS fix was taken on-device. The gap between this and
  -- received_at is itself context: a 40-minute-old fix means "no signal",
  -- not "hasn't moved", and the UI must render those differently.
  captured_at    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Reject fixes from the future (clock-skewed devices) and absurdly stale
  -- replays, both of which otherwise poison "last seen" copy.
  CONSTRAINT location_states_sane_capture
    CHECK (captured_at < now() + interval '5 minutes')
);

CREATE TRIGGER location_states_touch BEFORE UPDATE ON location_states
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

-- Supports place/geofence evaluation (ST_DWithin) on the live set.
CREATE INDEX location_states_geom_idx ON location_states USING GIST (geom);

-- Supports the weather refresh job: "whose weather snapshot is stale".
CREATE INDEX location_states_weather_stale_idx
  ON location_states (weather_observed_at NULLS FIRST);

-- ---------------------------------------------------------------------------
-- location_fuzz_anchors — the heart of Approximate mode
-- ---------------------------------------------------------------------------
-- Naive fuzzing adds random jitter to each update. That is worse than useless:
-- an observer who collects N samples averages the noise away and recovers the
-- true position to within jitter/sqrt(N). Watching someone's "fuzzy" dot for
-- an evening de-anonymises their home.
--
-- Haven instead SNAPS to a stable cell and caches the chosen centroid here.
-- The broadcast position only moves when the member genuinely leaves the cell
-- by more than the hysteresis margin, so repeated observation yields no new
-- information. The grid phase is salted per (user, circle) so cell boundaries
-- are not globally known and cannot be used to bound someone's position.
CREATE TABLE location_fuzz_anchors (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  circle_id   uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,

  radius_m    integer NOT NULL CHECK (radius_m BETWEEN 250 AND 25000),

  -- Cell centroid that is actually broadcast.
  geom        geography(Point, 4326) NOT NULL,
  -- Identifies the grid cell, so we can tell "same cell, don't move the dot"
  -- from "genuinely crossed into a new cell".
  cell_key    text NOT NULL,

  -- Per-pair grid phase salt. Rotated on a slow schedule; rotating it faster
  -- would re-introduce the averaging attack it exists to prevent.
  phase_salt  text NOT NULL,

  resolved_at timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, circle_id)
);

-- ---------------------------------------------------------------------------
-- location_history — opt-in, partitioned, aggressively expired
-- ---------------------------------------------------------------------------
-- Written only when users.history_enabled is true. Range-partitioned by month
-- so expiry is a DROP TABLE (instant, no bloat) rather than a DELETE sweep
-- across the hottest table in the system.
CREATE TABLE location_history (
  id             uuid NOT NULL DEFAULT haven_uuidv7(),
  user_id        uuid NOT NULL,

  geom           geography(Point, 4326) NOT NULL,
  accuracy_m     real NOT NULL DEFAULT 0,
  activity       activity_kind NOT NULL DEFAULT 'unknown',
  battery_percent smallint,

  captured_at    timestamptz NOT NULL,

  -- Partition key must participate in the primary key.
  PRIMARY KEY (captured_at, id)
) PARTITION BY RANGE (captured_at);

-- Catches rows that arrive outside any provisioned month instead of erroring
-- a user's location upload. Monitored: a non-empty default means the
-- partition-provisioning job has fallen behind.
CREATE TABLE location_history_default PARTITION OF location_history DEFAULT;

CREATE OR REPLACE FUNCTION haven_ensure_history_partition(for_month date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  start_at date := date_trunc('month', for_month)::date;
  end_at   date := (date_trunc('month', for_month) + interval '1 month')::date;
  part     text := format('location_history_%s', to_char(start_at, 'YYYYMM'));
BEGIN
  IF to_regclass(part) IS NOT NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF location_history FOR VALUES FROM (%L) TO (%L)',
    part, start_at, end_at
  );
  -- BRIN, not B-tree: rows arrive in captured_at order, so block-range
  -- summaries cover the table in a few kilobytes.
  EXECUTE format('CREATE INDEX %I ON %I USING BRIN (captured_at)',
                 part || '_captured_brin', part);
  EXECUTE format('CREATE INDEX %I ON %I (user_id, captured_at DESC)',
                 part || '_user_idx', part);
  EXECUTE format('CREATE INDEX %I ON %I USING GIST (geom)',
                 part || '_geom_idx', part);
END;
$$;

COMMENT ON FUNCTION haven_ensure_history_partition(date) IS
  'Idempotent. The provisioning job calls this for the current and next month.';

SELECT haven_ensure_history_partition(current_date);
SELECT haven_ensure_history_partition((current_date + interval '1 month')::date);
