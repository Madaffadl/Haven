-- 0003_circles.sql
-- Circles ("Spaces"), membership, invites, and the per-circle Trust Mode.

CREATE TABLE circles (
  id           uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  kind         circle_kind NOT NULL DEFAULT 'couple',
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  emoji        text,

  created_by   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  -- Small by design. A circle is an intimacy boundary, not a social network;
  -- the map legibly holds ~8 avatars and the product gets worse past that.
  max_members  smallint NOT NULL DEFAULT 8 CHECK (max_members BETWEEN 2 AND 16),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TRIGGER circles_touch BEFORE UPDATE ON circles
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

-- ---------------------------------------------------------------------------

CREATE TABLE circle_members (
  circle_id    uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  role         member_role NOT NULL DEFAULT 'member',

  -- Per-circle display override: "Dad" at home, "Rizal" with friends.
  nickname     text CHECK (nickname IS NULL OR length(btrim(nickname)) BETWEEN 1 AND 24),

  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,

  -- Muting is per-direction and per-circle: "stop buzzing me during work"
  -- without leaving the circle or going dark.
  nudges_muted_until timestamptz,

  PRIMARY KEY (circle_id, user_id)
);

-- The hot path for every broadcast: "who else is in this circle right now".
CREATE INDEX circle_members_active_idx ON circle_members (circle_id)
  WHERE left_at IS NULL;

-- The bootstrap path: "which circles does this socket join on connect".
CREATE INDEX circle_members_by_user_idx ON circle_members (user_id)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- Trust Mode
-- ---------------------------------------------------------------------------
-- Privacy is a property of the (member, circle) pair, never of the member
-- alone. The same person is Precise with their partner and Approximate with
-- the extended family at the same instant, and the broadcast fan-out resolves
-- this per destination room.
--
-- `mode = NULL` means "inherit users.default_trust_mode", which is what makes
-- the single quick-toggle in the UI able to flip every circle at once while
-- still allowing deliberate per-circle exceptions.
CREATE TABLE circle_member_trust (
  circle_id     uuid NOT NULL,
  user_id       uuid NOT NULL,

  mode          trust_mode,
  fuzz_radius_m integer NOT NULL DEFAULT 1000
                  CHECK (fuzz_radius_m BETWEEN 250 AND 25000),

  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (circle_id, user_id),
  FOREIGN KEY (circle_id, user_id)
    REFERENCES circle_members (circle_id, user_id) ON DELETE CASCADE
);

CREATE TRIGGER circle_member_trust_touch BEFORE UPDATE ON circle_member_trust
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

-- Append-only audit of every privacy change. In a product whose entire value
-- is trust, "when did my location stop being precise, and did I do it?" must
-- be answerable — both for the user's own transparency screen and for abuse
-- investigations where a coercive partner changed someone's settings.
CREATE TABLE trust_mode_changes (
  id          uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  circle_id   uuid REFERENCES circles (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Who performed the change. Must equal user_id today: nobody may set
  -- another member's privacy. Recorded explicitly so that stays auditable.
  actor_id    uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  device_id   uuid REFERENCES devices (id) ON DELETE SET NULL,

  from_mode   trust_mode,
  to_mode     trust_mode NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trust_mode_changes_user_idx ON trust_mode_changes (user_id, changed_at DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE circle_invites (
  id          uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  circle_id   uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Short, human-speakable, case-insensitive. Generated from an unambiguous
  -- alphabet (no O/0/I/1) because these get read aloud across a kitchen.
  code        citext NOT NULL CHECK (code ~ '^[A-HJ-NP-Z2-9]{6}$'),

  max_uses    smallint NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 20),
  uses        smallint NOT NULL DEFAULT 0 CHECK (uses >= 0),

  expires_at  timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT circle_invites_not_overused CHECK (uses <= max_uses)
);

-- Codes are only unique among live invites, so they can be recycled later.
CREATE UNIQUE INDEX circle_invites_live_code_key ON circle_invites (code)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Widget pins
-- ---------------------------------------------------------------------------
-- A home-screen widget shows one Inner Circle member per slot. Storing the
-- pin server-side (rather than only in the widget's own storage) lets the
-- backend decide *who* a background widget refresh is allowed to ask about,
-- and lets a push-triggered timeline reload target the right widget.
CREATE TABLE widget_pins (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot         smallint NOT NULL DEFAULT 0 CHECK (slot BETWEEN 0 AND 7),

  circle_id    uuid NOT NULL,
  target_user_id uuid NOT NULL,

  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, slot),

  -- Both ends must be live members of the same circle. If either leaves, the
  -- pin is removed and the widget falls back to its "nobody pinned" state —
  -- a widget must never outlive the relationship that authorised it.
  FOREIGN KEY (circle_id, target_user_id)
    REFERENCES circle_members (circle_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (circle_id, user_id)
    REFERENCES circle_members (circle_id, user_id) ON DELETE CASCADE,

  CONSTRAINT widget_pins_no_self_pin CHECK (target_user_id <> user_id)
);

CREATE TRIGGER widget_pins_touch BEFORE UPDATE ON widget_pins
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();
