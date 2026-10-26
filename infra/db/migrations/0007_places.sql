-- 0007_places.sql
-- Geofence foundation. Tables and indexes land now so the spatial model is
-- settled; arrival/departure wiring is deliberately NOT part of the v1.0
-- scope (the four pillars), and no event producer writes here yet.

CREATE TABLE places (
  id          uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  circle_id   uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  emoji       text,

  geom        geography(Point, 4326) NOT NULL,
  -- Floor of 80 m: tighter than that and ordinary GPS error produces a storm
  -- of false enter/exit pairs, which reads as noise rather than reassurance.
  radius_m    integer NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 80 AND 5000),

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TRIGGER places_touch BEFORE UPDATE ON places
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

CREATE INDEX places_geom_idx ON places USING GIST (geom) WHERE deleted_at IS NULL;
CREATE INDEX places_circle_idx ON places (circle_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE place_events (
  id          uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  place_id    uuid NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  transition  place_transition NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  -- Distance from the place centre at the moment of the transition. Lets us
  -- tune the hysteresis band from real data instead of guesswork.
  distance_m  real
);

CREATE INDEX place_events_place_idx ON place_events (place_id, occurred_at DESC);
CREATE INDEX place_events_user_idx ON place_events (user_id, occurred_at DESC);

-- Geofencing must respect Trust Mode. A member in 'ghost' generates no place
-- events at all, and in 'approximate' only for places whose radius exceeds
-- their fuzz radius — otherwise a 150 m geofence silently de-fuzzes someone
-- who explicitly chose not to share a precise position.
COMMENT ON TABLE place_events IS
  'Producers must consult haven_resolve_trust_mode() before writing.';
