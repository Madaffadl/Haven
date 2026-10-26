-- 0002_identity.sql
-- Users, their devices, and refresh-token sessions.

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT haven_uuidv7(),

  -- Phone is the primary identity: couples and families onboard by sharing a
  -- link, not by inventing usernames. Email is optional account recovery.
  phone_e164         citext UNIQUE,
  email              citext UNIQUE,

  display_name       text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 40),
  avatar_url         text,

  -- Accent used for this user's Battery Ring and avatar glow. Resolved once
  -- at signup so a person looks the same in every circle they belong to.
  accent_hex         text NOT NULL DEFAULT '#FFB4A2'
                       CHECK (accent_hex ~* '^#[0-9a-f]{6}$'),

  -- The global Trust Mode toggle. Per-circle rows in `circle_member_trust`
  -- may override it; NULL there means "inherit this".
  default_trust_mode trust_mode NOT NULL DEFAULT 'precise',

  -- Location history is OFF unless the user turns it on. Haven's promise is
  -- "peace of mind", not a travel log, so we do not retain a trail by default.
  history_enabled    boolean NOT NULL DEFAULT false,
  history_retention_days smallint NOT NULL DEFAULT 7
                       CHECK (history_retention_days BETWEEN 1 AND 90),

  locale             text NOT NULL DEFAULT 'en',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Soft delete: a departed member must vanish from their circles' maps
  -- immediately, but nudge/audit rows still reference them.
  deleted_at         timestamptz,

  CONSTRAINT users_need_an_identifier CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

CREATE INDEX users_active_idx ON users (id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE devices (
  id                 uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  platform           device_platform NOT NULL,
  model              text,
  os_version         text,
  app_version        text,

  -- APNs / FCM token. Nudges fall back to push when the recipient's socket
  -- is closed, which is most of the time — phones are asleep.
  push_token         text,
  push_token_updated_at timestamptz,

  -- Drives the "Haven can't see Maya right now" empty state instead of
  -- showing a silently frozen avatar.
  location_auth      location_authorization NOT NULL DEFAULT 'unknown',
  background_refresh_enabled boolean NOT NULL DEFAULT false,

  -- Set when the OS kills or throttles our background task, so support can
  -- tell "they turned it off" apart from "iOS suspended us".
  last_background_wake_at timestamptz,

  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);

CREATE TRIGGER devices_touch BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION haven_touch_updated_at();

CREATE INDEX devices_user_idx ON devices (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX devices_push_token_key ON devices (push_token)
  WHERE push_token IS NOT NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------

CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id          uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,

  -- Only the hash is stored; the token itself never touches the database.
  refresh_token_hash bytea NOT NULL,

  -- The home-screen widget runs in a separate process with its own short-TTL
  -- access token minted from this session, so revoking the session kills the
  -- widget's access too.
  widget_scope_enabled boolean NOT NULL DEFAULT true,

  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);

CREATE UNIQUE INDEX auth_sessions_token_key ON auth_sessions (refresh_token_hash);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id)
  WHERE revoked_at IS NULL;
