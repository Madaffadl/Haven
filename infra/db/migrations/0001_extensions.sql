-- 0001_extensions.sql
-- Extensions, shared enums, and the ID/timestamp primitives every table uses.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist; -- composite (uuid, geography) exclusion/indexes

-- ---------------------------------------------------------------------------
-- UUIDv7
-- ---------------------------------------------------------------------------
-- Every primary key is a UUIDv7: the leading 48 bits are a unix-millisecond
-- timestamp, so inserts stay sequential in the B-tree. On `location_history`
-- and `nudges` — append-only tables that take every write in the system —
-- random UUIDv4 keys would dirty a new page per insert and destroy write
-- throughput. UUIDv7 also makes "rows from the last hour" a key-range scan.
--
-- PostgreSQL 18 ships uuidv7() natively; this shim lets us run on 16/17.
CREATE OR REPLACE FUNCTION haven_uuidv7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

COMMENT ON FUNCTION haven_uuidv7() IS
  'Time-ordered UUIDv7. Replace with the built-in uuidv7() on PostgreSQL 18+.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Mirrors @haven/contracts `TrustMode`. Ordered least-private to most-private
-- so `>` comparisons mean "stricter than".
CREATE TYPE trust_mode AS ENUM ('precise', 'approximate', 'ghost');

CREATE TYPE battery_state AS ENUM ('unknown', 'unplugged', 'charging', 'full');

CREATE TYPE activity_kind AS ENUM (
  'unknown', 'still', 'walking', 'running', 'cycling', 'driving'
);

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

CREATE TYPE circle_kind AS ENUM ('couple', 'family', 'friends');

CREATE TYPE device_platform AS ENUM ('ios', 'android');

-- What the OS actually granted us. 'always' is the only value that supports
-- background context; everything else degrades the product and the UI must
-- say so rather than silently showing a stale dot.
CREATE TYPE location_authorization AS ENUM (
  'unknown', 'denied', 'when_in_use', 'always', 'reduced_accuracy'
);

CREATE TYPE nudge_kind AS ENUM (
  'heart', 'wave', 'thinking_of_you', 'home_safe', 'on_my_way', 'where_are_you'
);

CREATE TYPE place_transition AS ENUM ('enter', 'exit');
