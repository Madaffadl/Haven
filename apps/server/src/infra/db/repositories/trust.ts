import type { TrustMode } from '@haven/contracts';
import { pool } from '../pool.js';

/**
 * Apply a Trust Mode change and audit it, atomically.
 *
 * The audit row is written in the same transaction as the change itself. A
 * privacy setting that changed without a corresponding audit entry would make
 * the transparency screen lie, and that screen is the only way a user can
 * answer "did someone else make me visible?" — the question that matters in
 * a coercive-relationship scenario.
 *
 * `circleId === null` sets the global default, which every circle without an
 * explicit override inherits. That is what makes the single quick-toggle in
 * the UI able to flip everything at once.
 */
export const applyTrustChange = async (args: {
  userId: string;
  actorId: string;
  deviceId: string | null;
  circleId: string | null;
  mode: TrustMode;
  fuzzRadiusM?: number;
}): Promise<{ affectedCircleIds: string[] }> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const previous = await client.query<{ mode: TrustMode }>(
      args.circleId
        ? 'SELECT haven_resolve_trust_mode($1, $2) AS mode'
        : 'SELECT default_trust_mode AS mode FROM users WHERE id = $1',
      args.circleId ? [args.userId, args.circleId] : [args.userId],
    );

    let affectedCircleIds: string[];

    if (args.circleId) {
      await client.query(
        `
        INSERT INTO circle_member_trust (circle_id, user_id, mode, fuzz_radius_m)
        VALUES ($1, $2, $3, COALESCE($4, 1000))
        ON CONFLICT (circle_id, user_id) DO UPDATE SET
          mode          = EXCLUDED.mode,
          fuzz_radius_m = COALESCE($4, circle_member_trust.fuzz_radius_m),
          updated_at    = now()
        `,
        [args.circleId, args.userId, args.mode, args.fuzzRadiusM ?? null],
      );
      affectedCircleIds = [args.circleId];
    } else {
      await client.query('UPDATE users SET default_trust_mode = $2 WHERE id = $1', [
        args.userId,
        args.mode,
      ]);

      // Only circles that inherit are affected; explicit overrides stand.
      const inheriting = await client.query<{ circle_id: string }>(
        `
        SELECT m.circle_id
          FROM circle_members m
          LEFT JOIN circle_member_trust t
                 ON t.circle_id = m.circle_id AND t.user_id = m.user_id
         WHERE m.user_id = $1 AND m.left_at IS NULL AND t.mode IS NULL
        `,
        [args.userId],
      );
      affectedCircleIds = inheriting.rows.map((row) => row.circle_id);
    }

    await client.query(
      `
      INSERT INTO trust_mode_changes
        (circle_id, user_id, actor_id, device_id, from_mode, to_mode)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        args.circleId,
        args.userId,
        args.actorId,
        args.deviceId,
        previous.rows[0]?.mode ?? null,
        args.mode,
      ],
    );

    await client.query('COMMIT');
    return { affectedCircleIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Dropped when a member leaves Approximate; a stale cell must not linger. */
export const clearAnchors = async (args: {
  userId: string;
  circleIds: string[];
}): Promise<void> => {
  if (args.circleIds.length === 0) return;
  await pool.query(
    'DELETE FROM location_fuzz_anchors WHERE user_id = $1 AND circle_id = ANY($2::uuid[])',
    [args.userId, args.circleIds],
  );
};
