import {
  CIRCLE_SEATS,
  type CircleKind,
  type CircleSummary,
  type Invite,
  type InvitePreview,
  type MemberRole,
} from '@haven/contracts';
import type { PoolClient } from 'pg';

import { defaultInviteUses, generateInviteCode } from '../../../domain/circle/inviteCode.js';
import { pool } from '../pool.js';

/**
 * Creating circles, inviting people into them, and joining.
 *
 * Kept apart from ./circle.ts, which serves the realtime read path: these run
 * a few times in a circle's life, and they are the only writes that change
 * who can see whom.
 */

interface SummaryRow {
  id: string;
  name: string;
  kind: CircleKind;
  role: MemberRole;
  member_count: number;
  max_members: number;
}

const toSummary = (row: SummaryRow): CircleSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  role: row.role,
  memberCount: row.member_count,
  maxMembers: row.max_members,
});

const SUMMARY_SELECT = `
  SELECT c.id, c.name, c.kind, m.role, c.max_members,
         (SELECT count(*) FROM circle_members x
           WHERE x.circle_id = c.id AND x.left_at IS NULL)::int AS member_count
    FROM circle_members m
    JOIN circles c ON c.id = m.circle_id
   WHERE m.user_id = $1 AND m.left_at IS NULL AND c.deleted_at IS NULL
`;

export const listCircles = async (userId: string): Promise<CircleSummary[]> => {
  const { rows } = await pool.query<SummaryRow>(`${SUMMARY_SELECT} ORDER BY m.joined_at`, [userId]);
  return rows.map(toSummary);
};

const circleFor = async (
  db: Pick<PoolClient, 'query'>,
  userId: string,
  circleId: string,
): Promise<CircleSummary | null> => {
  const { rows } = await db.query<SummaryRow>(`${SUMMARY_SELECT} AND c.id = $2`, [
    userId,
    circleId,
  ]);
  return rows[0] ? toSummary(rows[0]) : null;
};

export const createCircle = async (args: {
  userId: string;
  name: string;
  kind: CircleKind;
}): Promise<CircleSummary> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO circles (kind, name, created_by, max_members) VALUES ($1, $2, $3, $4) RETURNING id',
      [args.kind, args.name, args.userId, CIRCLE_SEATS[args.kind]],
    );
    const circleId = rows[0]!.id;

    await client.query(
      "INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'owner')",
      [circleId, args.userId],
    );

    const summary = await circleFor(client, args.userId, circleId);
    await client.query('COMMIT');
    return summary!;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export type CreateInviteResult =
  { status: 'ok'; invite: Invite } | { status: 'not_a_member' } | { status: 'circle_full' };

const UNIQUE_VIOLATION = '23505';

/**
 * Any member may invite, as long as a seat is open. The seat check here is
 * advisory: the binding one is in `acceptInvite`, under a lock, because seats
 * can fill between the invite being made and being used.
 */
export const createInvite = async (args: {
  userId: string;
  circleId: string;
}): Promise<CreateInviteResult> => {
  const circle = await circleFor(pool, args.userId, args.circleId);
  if (!circle) return { status: 'not_a_member' };
  if (circle.memberCount >= circle.maxMembers) return { status: 'circle_full' };

  const maxUses = defaultInviteUses(circle.memberCount, circle.maxMembers);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const { rows } = await pool.query<{ code: string; expires_at: Date }>(
        `
        INSERT INTO circle_invites (circle_id, created_by, code, max_uses)
        VALUES ($1, $2, $3, $4)
        RETURNING code::text, expires_at
        `,
        [args.circleId, args.userId, generateInviteCode(), maxUses],
      );
      const row = rows[0]!;
      return {
        status: 'ok',
        invite: {
          code: row.code,
          circleId: args.circleId,
          maxUses,
          expiresAt: row.expires_at.toISOString(),
        },
      };
    } catch (error) {
      // A code collision; draw another. Bounded so a broken index cannot
      // turn into an infinite loop.
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION || attempt >= 4) throw error;
    }
  }
};

/** An invite that can still be used, joined to what the invitee needs to decide. */
const LIVE_INVITE = `
  FROM circle_invites i
  JOIN circles c ON c.id = i.circle_id
  JOIN users   u ON u.id = i.created_by
 WHERE i.code = $1
   AND i.revoked_at IS NULL
   AND i.expires_at > now()
   AND i.uses < i.max_uses
   AND c.deleted_at IS NULL
`;

export const previewInvite = async (
  code: string,
  viewerId: string,
): Promise<InvitePreview | null> => {
  const { rows } = await pool.query<{
    circle_id: string;
    name: string;
    kind: CircleKind;
    max_members: number;
    inviter_name: string;
    member_count: number;
    already_member: boolean;
  }>(
    `
    SELECT i.circle_id, c.name, c.kind, c.max_members, u.display_name AS inviter_name,
           (SELECT count(*) FROM circle_members x
             WHERE x.circle_id = i.circle_id AND x.left_at IS NULL)::int AS member_count,
           EXISTS (SELECT 1 FROM circle_members y
                    WHERE y.circle_id = i.circle_id AND y.user_id = $2 AND y.left_at IS NULL)
             AS already_member
    ${LIVE_INVITE}
    `,
    [code, viewerId],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    circleId: row.circle_id,
    circleName: row.name,
    kind: row.kind,
    inviterName: row.inviter_name,
    memberCount: row.member_count,
    maxMembers: row.max_members,
    alreadyMember: row.already_member,
  };
};

export type AcceptInviteOutcome =
  | { status: 'joined' | 'already_member'; circle: CircleSummary }
  | { status: 'invite_invalid' }
  | { status: 'circle_full' };

/**
 * Join through an invite.
 *
 * Both the invite and the circle row are locked. The invite lock makes the
 * last use of a single-use code go to exactly one person; the circle lock
 * serialises joins through *different* invites, which could otherwise each
 * see one free seat and together overfill the circle.
 *
 * Someone who left and comes back gets their old membership row revived with
 * a fresh join date, since (circle_id, user_id) is the primary key.
 */
export const acceptInvite = async (args: {
  code: string;
  userId: string;
}): Promise<AcceptInviteOutcome> => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const invite = await client.query<{ id: string; circle_id: string }>(
      `SELECT i.id, i.circle_id ${LIVE_INVITE} FOR UPDATE OF i`,
      [args.code],
    );
    const live = invite.rows[0];
    if (!live) {
      await client.query('ROLLBACK');
      return { status: 'invite_invalid' };
    }

    // Lock first, count second: the count is only trustworthy once every
    // other joiner of this circle is queued behind the lock.
    const locked = await client.query<{ max_members: number }>(
      'SELECT max_members FROM circles WHERE id = $1 FOR UPDATE',
      [live.circle_id],
    );
    const maxMembers = locked.rows[0]!.max_members;

    const seats = await client.query<{ member_count: number; mine: boolean }>(
      `
      SELECT count(*)::int AS member_count,
             coalesce(bool_or(user_id = $2), false) AS mine
        FROM circle_members
       WHERE circle_id = $1 AND left_at IS NULL
      `,
      [live.circle_id, args.userId],
    );
    const { member_count: memberCount, mine } = seats.rows[0]!;

    // Accepting twice must not burn a use or move the join date.
    if (mine) {
      const circle = await circleFor(client, args.userId, live.circle_id);
      await client.query('COMMIT');
      return { status: 'already_member', circle: circle! };
    }

    if (memberCount >= maxMembers) {
      await client.query('ROLLBACK');
      return { status: 'circle_full' };
    }

    await client.query(
      `
      INSERT INTO circle_members (circle_id, user_id, role)
      VALUES ($1, $2, 'member')
      ON CONFLICT (circle_id, user_id) DO UPDATE SET
        role               = 'member',
        nickname           = NULL,
        nudges_muted_until = NULL,
        joined_at          = now(),
        left_at            = NULL
      `,
      [live.circle_id, args.userId],
    );

    await client.query('UPDATE circle_invites SET uses = uses + 1 WHERE id = $1', [live.id]);

    const circle = await circleFor(client, args.userId, live.circle_id);
    await client.query('COMMIT');
    return { status: 'joined', circle: circle! };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export type LeaveOutcome = 'left' | 'not_a_member';

/**
 * Leave one circle, inside the caller's transaction (also used by account
 * deletion, which leaves every circle at once).
 *
 * What goes with the membership:
 *   - fuzz anchors for this circle: a stale cell must not outlive the reason
 *     it existed;
 *   - widget pins in either direction: a widget must never keep showing
 *     someone after the relationship that allowed it has ended;
 *   - invites this member made: their code was their word, and they are no
 *     longer here to stand behind it.
 *
 * An owner who leaves hands the circle on (admins first, then whoever joined
 * earliest), so the circle never sits there without anyone able to run it.
 * The last person out closes it.
 */
export const leaveWithin = async (
  db: Pick<PoolClient, 'query'>,
  args: { userId: string; circleId: string },
): Promise<LeaveOutcome> => {
  const { userId, circleId } = args;

  // Serialise with joins and other leaves, so seat counts and the ownership
  // hand-off see one consistent membership.
  await db.query('SELECT 1 FROM circles WHERE id = $1 FOR UPDATE', [circleId]);

  const left = await db.query<{ role: MemberRole }>(
    `
    UPDATE circle_members SET left_at = now()
     WHERE circle_id = $1 AND user_id = $2 AND left_at IS NULL
    RETURNING role
    `,
    [circleId, userId],
  );
  const role = left.rows[0]?.role;
  if (!role) return 'not_a_member';

  await db.query('DELETE FROM location_fuzz_anchors WHERE circle_id = $1 AND user_id = $2', [
    circleId,
    userId,
  ]);
  await db.query(
    'DELETE FROM widget_pins WHERE circle_id = $1 AND (user_id = $2 OR target_user_id = $2)',
    [circleId, userId],
  );
  await db.query(
    `
    UPDATE circle_invites SET revoked_at = now()
     WHERE circle_id = $1 AND created_by = $2 AND revoked_at IS NULL
    `,
    [circleId, userId],
  );

  if (role === 'owner') {
    await db.query(
      `
      UPDATE circle_members SET role = 'owner'
       WHERE circle_id = $1
         AND user_id = (
           SELECT user_id FROM circle_members
            WHERE circle_id = $1 AND left_at IS NULL
            ORDER BY (role = 'admin') DESC, joined_at
            LIMIT 1
         )
      `,
      [circleId],
    );
  }

  const remaining = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM circle_members WHERE circle_id = $1 AND left_at IS NULL',
    [circleId],
  );
  if (remaining.rows[0]!.n === 0) {
    await db.query('UPDATE circles SET deleted_at = now() WHERE id = $1', [circleId]);
    await db.query(
      'UPDATE circle_invites SET revoked_at = now() WHERE circle_id = $1 AND revoked_at IS NULL',
      [circleId],
    );
  }

  return 'left';
};

export const leaveCircle = async (args: {
  userId: string;
  circleId: string;
}): Promise<LeaveOutcome> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await leaveWithin(client, args);
    await client.query(outcome === 'left' ? 'COMMIT' : 'ROLLBACK');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
