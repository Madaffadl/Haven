-- 0008_presence_projection.sql
-- The single read path that turns stored truth into what a given viewer is
-- allowed to see. Used for socket bootstrap, REST refresh, and the widget.

-- ---------------------------------------------------------------------------
-- haven_circle_presence(viewer, circle)
-- ---------------------------------------------------------------------------
-- Exactly one function performs the privacy projection, and no other query in
-- the system is permitted to SELECT raw geometry out of location_states. That
-- is the whole containment strategy: there is one place to review, one place
-- to test, and a new feature cannot accidentally bypass Trust Mode by writing
-- its own join.
--
-- Liveness (`online`) is intentionally absent — it lives in Redis, since a
-- socket connecting and dropping must not write to Postgres.
CREATE OR REPLACE FUNCTION haven_circle_presence(
  p_viewer_id uuid,
  p_circle_id uuid
) RETURNS TABLE (
  user_id         uuid,
  display_name    text,
  nickname        text,
  avatar_url      text,
  accent_hex      text,
  trust_mode      trust_mode,
  lon             double precision,
  lat             double precision,
  radius_m        double precision,
  battery_percent smallint,
  battery_state   battery_state,
  power_saving    boolean,
  weather_code    smallint,
  weather_temp_c  real,
  weather_is_day  boolean,
  weather_observed_at timestamptz,
  timezone        text,
  activity        activity_kind,
  captured_at     timestamptz,
  is_stale        boolean
)
-- SECURITY DEFINER is load-bearing, not incidental: it is what lets us revoke
-- the raw `geom` column from the application role (see the grants at the
-- bottom of this file) while still allowing the projection to read it. The
-- function owner is the only principal that can see precise coordinates.
-- search_path is pinned, as it must be for any definer function.
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH viewer AS (
    -- Membership check lives inside the function, so a caller cannot forget
    -- it. A non-member gets zero rows rather than an error — no probing
    -- whether a circle exists.
    SELECT 1
      FROM circle_members m
     WHERE m.circle_id = p_circle_id
       AND m.user_id = p_viewer_id
       AND m.left_at IS NULL
  ),
  resolved AS (
    SELECT
      m.user_id,
      u.display_name,
      m.nickname,
      u.avatar_url,
      u.accent_hex,
      -- A member always sees their own true position, whatever their Trust
      -- Mode says about what others see.
      CASE WHEN m.user_id = p_viewer_id
           THEN 'precise'::trust_mode
           ELSE haven_resolve_trust_mode(m.user_id, p_circle_id)
      END AS mode,
      COALESCE(t.fuzz_radius_m, 1000)::double precision AS fuzz_radius_m,
      s.geom,
      s.accuracy_m,
      a.geom AS anchor_geom,
      s.battery_percent,
      s.battery_state,
      s.power_saving,
      s.weather_code,
      s.weather_temp_c,
      s.weather_is_day,
      s.weather_observed_at,
      s.timezone,
      s.activity,
      s.captured_at
    FROM circle_members m
    JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    LEFT JOIN location_states s ON s.user_id = m.user_id
    LEFT JOIN circle_member_trust t
           ON t.circle_id = m.circle_id AND t.user_id = m.user_id
    LEFT JOIN location_fuzz_anchors a
           ON a.user_id = m.user_id AND a.circle_id = m.circle_id
    WHERE m.circle_id = p_circle_id
      AND m.left_at IS NULL
      AND EXISTS (SELECT 1 FROM viewer)
  ),
  projected AS (
    SELECT
      r.*,
      CASE r.mode
        WHEN 'precise'     THEN r.geom
        -- Fail closed: if Approximate is on but no anchor has been written
        -- yet, emit nothing rather than falling back to the real point.
        WHEN 'approximate' THEN r.anchor_geom
        ELSE NULL
      END AS shown_geom,
      CASE r.mode
        WHEN 'precise'     THEN GREATEST(r.accuracy_m, 5)::double precision
        WHEN 'approximate' THEN r.fuzz_radius_m
        ELSE NULL
      END AS shown_radius_m
    FROM resolved r
  )
  SELECT
    p.user_id,
    p.display_name,
    p.nickname,
    p.avatar_url,
    p.accent_hex,
    p.mode,
    CASE WHEN p.shown_geom IS NULL THEN NULL ELSE ST_X(p.shown_geom::geometry) END,
    CASE WHEN p.shown_geom IS NULL THEN NULL ELSE ST_Y(p.shown_geom::geometry) END,
    CASE WHEN p.shown_geom IS NULL THEN NULL ELSE p.shown_radius_m END,
    p.battery_percent,
    COALESCE(p.battery_state, 'unknown'::battery_state),
    COALESCE(p.power_saving, false),
    p.weather_code,
    p.weather_temp_c,
    p.weather_is_day,
    p.weather_observed_at,
    -- Withheld in 'ghost': "it's 3am there" is a coarse longitude signal, and
    -- a member who hid their position did not agree to leak it sideways.
    CASE WHEN p.mode = 'ghost' THEN NULL ELSE p.timezone END,
    COALESCE(p.activity, 'unknown'::activity_kind),
    p.captured_at,
    -- "Stale" is a first-class product state, not an error: it is the
    -- difference between "parked at home" and "phone lost signal an hour ago",
    -- and the map renders the two completely differently.
    (p.captured_at IS NULL OR p.captured_at < now() - interval '20 minutes')
  FROM projected p;
$$;

COMMENT ON FUNCTION haven_circle_presence(uuid, uuid) IS
  'The ONLY sanctioned read of location_states. Never join that table directly.';

-- ---------------------------------------------------------------------------
-- Least privilege
-- ---------------------------------------------------------------------------
-- The application connects as haven_app, which may WRITE precise coordinates
-- (it has to — that is the location upload path) but may not SELECT them.
-- Reads go exclusively through the definer function above. A developer who
-- writes `SELECT geom FROM location_states` gets a permission error on their
-- own machine instead of shipping a privacy leak.
--
-- Run once per environment, as the owning role, outside this migration:
--
--   CREATE ROLE haven_app LOGIN PASSWORD '...';
--   GRANT USAGE ON SCHEMA public TO haven_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO haven_app;
--
--   -- Column-level revoke. INSERT/UPDATE on geom stay granted.
--   REVOKE SELECT ON location_states FROM haven_app;
--   GRANT SELECT (user_id, device_id, accuracy_m, activity, battery_percent,
--                 battery_state, power_saving, timezone, weather_code,
--                 weather_temp_c, weather_is_day, weather_observed_at,
--                 captured_at, received_at, updated_at)
--     ON location_states TO haven_app;
--
--   GRANT EXECUTE ON FUNCTION haven_circle_presence(uuid, uuid) TO haven_app;
--
-- The fuzz-anchor writer is the one job that legitimately needs to read geom.
-- It runs as its own role (haven_fuzz) rather than widening haven_app:
--
--   CREATE ROLE haven_fuzz LOGIN PASSWORD '...';
--   GRANT SELECT (user_id, geom) ON location_states TO haven_fuzz;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON location_fuzz_anchors TO haven_fuzz;
