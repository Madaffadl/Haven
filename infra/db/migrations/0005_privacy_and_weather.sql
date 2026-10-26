-- 0005_privacy_and_weather.sql
-- The spatial primitives behind Trust Mode, plus the shared weather cache.

-- ---------------------------------------------------------------------------
-- haven_snap_to_cell — deterministic, salted grid snapping
-- ---------------------------------------------------------------------------
-- Projects `pt` into a square grid of ~2*radius_m cells and returns the cell
-- centroid. Properties that matter:
--
--   * Deterministic — the same input always yields the same output, so an
--     observer collecting samples learns nothing beyond "in this cell".
--   * Salted — `phase_key` shifts the grid origin per (user, circle), so the
--     lattice is not public knowledge and a centroid cannot be inverted into
--     a known cell boundary.
--   * Latitude-corrected — EPSG:3857 metres shrink by cos(latitude), so the
--     cell is widened to keep real-world size roughly constant. Without this
--     a "1 km" cell in Helsinki is ~500 m on the ground.
--
-- Returns NULL for NULL input so callers can't accidentally publish (0, 0).
--
-- `haven_cell` is the single implementation; `haven_snap_to_cell` and
-- `haven_cell_key` are thin accessors over it. The TypeScript twin in
-- apps/server/src/domain/location/fuzz.ts produces identical output for
-- identical input, and `test/fuzz.test.ts` pins the exact cell_key format —
-- if SQL and TS ever disagree on which cell a point is in, the anchor cached
-- by one and read by the other would move the avatar for no reason.
CREATE TYPE haven_cell_t AS (cell_key text, centroid geography);

CREATE OR REPLACE FUNCTION haven_cell(
  pt         geography,
  radius_m   double precision,
  phase_key  text
) RETURNS haven_cell_t
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  lat       double precision;
  lat_band  bigint;
  cell      double precision;
  mercator  geometry;
  phase_x   double precision;
  phase_y   double precision;
  grid_x    bigint;
  grid_y    bigint;
  result    haven_cell_t;
BEGIN
  IF pt IS NULL OR radius_m IS NULL THEN
    RETURN NULL;
  END IF;

  lat := ST_Y(pt::geometry);

  -- The cos() correction is quantised into 1-degree latitude bands. Using the
  -- exact latitude would make cell size a continuous function of position:
  -- every metre of GPS wobble would resize the cell, shift the lattice, and
  -- move the centroid — so a stationary member would emit a different
  -- coordinate every report and the averaging attack would succeed against
  -- what looks like a stable grid. Bands are ~111 km tall; anchor hysteresis
  -- absorbs the discontinuity at a boundary.
  lat_band := floor(lat)::bigint;

  -- Clamp the correction: near the poles it explodes, and Web Mercator is
  -- undefined past ~85 degrees anyway.
  cell := (GREATEST(radius_m, 100.0) * 2.0)
          / GREATEST(cos(radians(lat_band::double precision + 0.5)), 0.05);

  mercator := ST_Transform(pt::geometry, 3857);

  -- md5 rather than hashtext(): hashtext is an internal function whose output
  -- is not guaranteed stable across major versions, and a phase that shifted
  -- during an upgrade would teleport every fuzzy avatar at once.
  phase_x := (('x' || substr(md5(phase_key || ':x'), 1, 6))::bit(24)::int)::double precision
             / 16777216.0 * cell;
  phase_y := (('x' || substr(md5(phase_key || ':y'), 1, 6))::bit(24)::int)::double precision
             / 16777216.0 * cell;

  grid_x := floor((ST_X(mercator) + phase_x) / cell)::bigint;
  grid_y := floor((ST_Y(mercator) + phase_y) / cell)::bigint;

  result.cell_key := round(radius_m)::text || ':' || lat_band::text
                     || ':' || grid_x::text || ':' || grid_y::text;
  result.centroid := ST_Transform(
    ST_SetSRID(
      ST_MakePoint(
        (grid_x::double precision + 0.5) * cell - phase_x,
        (grid_y::double precision + 0.5) * cell - phase_y
      ),
      3857
    ),
    4326
  )::geography;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION haven_snap_to_cell(
  pt geography, radius_m double precision, phase_key text
) RETURNS geography
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (haven_cell(pt, radius_m, phase_key)).centroid;
$$;

-- Stable identifier for the cell a point falls into, used to detect "still in
-- the same cell" without comparing floating-point centroids.
CREATE OR REPLACE FUNCTION haven_cell_key(
  pt geography, radius_m double precision, phase_key text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (haven_cell(pt, radius_m, phase_key)).cell_key;
$$;

-- ---------------------------------------------------------------------------
-- haven_resolve_trust_mode — the inheritance rule, in one place
-- ---------------------------------------------------------------------------
-- A per-circle row wins; a NULL mode there (or no row at all) inherits the
-- user's global default. Keeping this in SQL means the broadcast query, the
-- widget endpoint and any future export all resolve privacy identically —
-- a divergence here is a privacy incident, not a bug.
CREATE OR REPLACE FUNCTION haven_resolve_trust_mode(
  p_user_id   uuid,
  p_circle_id uuid
) RETURNS trust_mode
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT t.mode
       FROM circle_member_trust t
      WHERE t.user_id = p_user_id AND t.circle_id = p_circle_id),
    (SELECT u.default_trust_mode FROM users u WHERE u.id = p_user_id),
    'ghost'::trust_mode  -- fail closed: an unknown user shares nothing
  );
$$;

-- ---------------------------------------------------------------------------
-- weather_cache
-- ---------------------------------------------------------------------------
-- Weather is fetched per ~10 km cell, not per user. Members of one household
-- share a cell, so a family of four costs one upstream call. The cell is
-- coarse enough that the cache key itself leaks nothing useful even if the
-- provider logs it.
CREATE TABLE weather_cache (
  cell_key       text PRIMARY KEY,
  geom           geography(Point, 4326) NOT NULL,

  code           smallint NOT NULL CHECK (code BETWEEN 0 AND 99),  -- WMO code
  temperature_c  real NOT NULL,
  is_day         boolean NOT NULL,

  observed_at    timestamptz NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);

CREATE INDEX weather_cache_expiry_idx ON weather_cache (expires_at);
CREATE INDEX weather_cache_geom_idx ON weather_cache USING GIST (geom);

COMMENT ON TABLE weather_cache IS
  'Keyed by haven_cell_key(geom, 10000, ''weather''). Rows are disposable.';
