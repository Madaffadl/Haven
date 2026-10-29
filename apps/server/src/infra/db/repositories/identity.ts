import type { DeviceInfo, Me, TrustMode } from '@haven/contracts';
import { pool } from '../pool.js';

interface MeRow {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  accent_hex: string;
  default_trust_mode: TrustMode;
}

const toMe = (row: MeRow): Me => ({
  userId: row.id,
  email: row.email,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  accentHex: row.accent_hex,
  trustMode: row.default_trust_mode,
});

export type SignInUser = { status: 'active'; me: Me; created: boolean } | { status: 'deleted' };

/**
 * The account for this address, created on first sign-in.
 *
 * Insert-or-select in one statement: two devices verifying codes for a new
 * address at the same instant must land on one user, and ON CONFLICT is the
 * only race-free way to get that without a lock.
 *
 * A soft-deleted account is reported rather than revived. Deletion promises
 * that the person vanished from every circle, and quietly signing them back
 * in would break it.
 */
export const findOrCreateUserByEmail = async (args: {
  email: string;
  displayName: string;
  accentHex: string;
}): Promise<SignInUser> => {
  const { rows } = await pool.query<MeRow & { created: boolean; deleted: boolean }>(
    `
    WITH inserted AS (
      INSERT INTO users (email, display_name, accent_hex)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email::text, display_name, avatar_url, accent_hex, default_trust_mode
    )
    SELECT *, true AS created, false AS deleted FROM inserted
    UNION ALL
    SELECT id, email::text, display_name, avatar_url, accent_hex, default_trust_mode,
           false AS created, deleted_at IS NOT NULL AS deleted
      FROM users
     WHERE email = $1 AND NOT EXISTS (SELECT 1 FROM inserted)
    `,
    [args.email, args.displayName, args.accentHex],
  );

  const row = rows[0];
  if (!row) throw new Error('user upsert returned no row');
  if (row.deleted) return { status: 'deleted' };
  return { status: 'active', me: toMe(row), created: row.created };
};

/**
 * One device row and one session per sign-in, together. A session without
 * its device would fail the join every authenticated request makes.
 */
export const createSession = async (args: {
  userId: string;
  device: DeviceInfo;
  refreshTokenHash: Buffer;
  ttlDays: number;
}): Promise<{ sessionId: string; deviceId: string }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const device = await client.query<{ id: string }>(
      `
      INSERT INTO devices (user_id, platform, os_version, app_version, last_seen_at)
      VALUES ($1, $2, $3, $4, now())
      RETURNING id
      `,
      [
        args.userId,
        args.device.platform,
        args.device.osVersion ?? null,
        args.device.appVersion ?? null,
      ],
    );
    const deviceId = device.rows[0]!.id;

    const session = await client.query<{ id: string }>(
      `
      INSERT INTO auth_sessions (user_id, device_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, $3, now() + make_interval(days => $4))
      RETURNING id
      `,
      [args.userId, deviceId, args.refreshTokenHash, args.ttlDays],
    );

    await client.query('COMMIT');
    return { sessionId: session.rows[0]!.id, deviceId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Swap a refresh token for a new one, in one statement.
 *
 * The WHERE on the old hash is the whole rotation: a token that was already
 * rotated matches nothing, so a copied refresh token stops working the moment
 * its owner's phone refreshes. Expiry slides forward with use, so only a
 * device left untouched for the full TTL has to sign in again.
 */
export const rotateRefreshToken = async (args: {
  currentHash: Buffer;
  nextHash: Buffer;
  ttlDays: number;
}): Promise<{ sessionId: string; userId: string; deviceId: string } | null> => {
  const { rows } = await pool.query<{ sessionId: string; userId: string; deviceId: string }>(
    `
    UPDATE auth_sessions s
       SET refresh_token_hash = $2,
           last_used_at       = now(),
           expires_at         = now() + make_interval(days => $3)
      FROM devices d, users u
     WHERE s.refresh_token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND d.id = s.device_id AND d.revoked_at IS NULL
       AND u.id = s.user_id   AND u.deleted_at IS NULL
    RETURNING s.id AS "sessionId", s.user_id AS "userId", s.device_id AS "deviceId"
    `,
    [args.currentHash, args.nextHash, args.ttlDays],
  );
  return rows[0] ?? null;
};

export const revokeSession = async (sessionId: string): Promise<void> => {
  await pool.query(
    'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [sessionId],
  );
};

/**
 * Is the session behind an access token still good?
 *
 * Shared by the socket handshake and every authenticated REST call, so
 * "sign out this device" means the same thing on both: effective on the next
 * request, not when the access token happens to expire.
 */
export const isSessionLive = async (claims: {
  sid: string;
  sub: string;
  did: string;
}): Promise<boolean> => {
  const { rowCount } = await pool.query(
    `
    SELECT 1
      FROM auth_sessions s
      JOIN devices d ON d.id = s.device_id
      JOIN users   u ON u.id = s.user_id
     WHERE s.id = $1
       AND s.user_id = $2
       AND s.device_id = $3
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND d.revoked_at IS NULL
       AND u.deleted_at IS NULL
    `,
    [claims.sid, claims.sub, claims.did],
  );
  return (rowCount ?? 0) > 0;
};

export const getMe = async (userId: string): Promise<Me | null> => {
  const { rows } = await pool.query<MeRow>(
    `
    SELECT id, email::text, display_name, avatar_url, accent_hex, default_trust_mode
      FROM users
     WHERE id = $1 AND deleted_at IS NULL
    `,
    [userId],
  );
  return rows[0] ? toMe(rows[0]) : null;
};

export const updateDisplayName = async (userId: string, displayName: string): Promise<Me> => {
  const { rows } = await pool.query<MeRow>(
    `
    UPDATE users SET display_name = $2
     WHERE id = $1 AND deleted_at IS NULL
    RETURNING id, email::text, display_name, avatar_url, accent_hex, default_trust_mode
    `,
    [userId, displayName],
  );
  if (!rows[0]) throw new Error('user vanished during update');
  return toMe(rows[0]);
};
