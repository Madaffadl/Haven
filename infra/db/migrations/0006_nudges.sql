-- 0006_nudges.sql
-- Tap-to-Nudge. Ephemeral by design: nudges are a gesture, not a transcript.

CREATE TABLE nudges (
  id              uuid PRIMARY KEY DEFAULT haven_uuidv7(),
  circle_id       uuid NOT NULL REFERENCES circles (id) ON DELETE CASCADE,

  from_user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- NULL means the nudge went to the whole circle.
  to_user_id      uuid REFERENCES users (id) ON DELETE CASCADE,

  kind            nudge_kind NOT NULL,

  -- Client-generated UUIDv7. A socket that reconnects mid-send will retry,
  -- and without this the recipient gets the same heart bursting twice.
  client_nudge_id uuid NOT NULL,

  sent_at         timestamptz NOT NULL DEFAULT now(),

  -- Set when the recipient's client acknowledges render, which is what powers
  -- the sender's "seen" affordance. Push delivery alone does not count.
  acked_at        timestamptz,

  CONSTRAINT nudges_no_self_nudge CHECK (to_user_id IS NULL OR to_user_id <> from_user_id)
);

-- Idempotency key for retries.
CREATE UNIQUE INDEX nudges_client_id_key ON nudges (from_user_id, client_nudge_id);

-- Rate limiting and the "recent nudges" strip both read this.
CREATE INDEX nudges_circle_recent_idx ON nudges (circle_id, sent_at DESC);
CREATE INDEX nudges_inbox_idx ON nudges (to_user_id, sent_at DESC)
  WHERE to_user_id IS NOT NULL;

COMMENT ON TABLE nudges IS
  'Retention: 30 days, purged by the nightly job. Nothing here is a message '
  'archive — the product deliberately has no chat history to subpoena.';
