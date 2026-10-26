import type { NudgeKind } from '@haven/contracts';
import { pool } from '../pool.js';

export interface StoredNudge {
  id: string;
  sentAt: Date;
  /** False when this was a retry of an already-recorded nudge. */
  created: boolean;
}

/**
 * Record a nudge, idempotently.
 *
 * `ON CONFLICT DO NOTHING` plus a follow-up SELECT, rather than DO UPDATE:
 * a retried nudge must return the *original* id and timestamp so the
 * recipient's client can recognise it as a duplicate of something it has
 * already animated. A phone on a flaky connection retries constantly, and
 * the same heart bursting twice on screen reads as the app glitching.
 */
export const recordNudge = async (args: {
  circleId: string;
  fromUserId: string;
  toUserId: string | null;
  kind: NudgeKind;
  clientNudgeId: string;
}): Promise<StoredNudge> => {
  const inserted = await pool.query<{ id: string; sent_at: Date }>(
    `
    INSERT INTO nudges (circle_id, from_user_id, to_user_id, kind, client_nudge_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (from_user_id, client_nudge_id) DO NOTHING
    RETURNING id, sent_at
    `,
    [args.circleId, args.fromUserId, args.toUserId, args.kind, args.clientNudgeId],
  );

  const row = inserted.rows[0];
  if (row) {
    return { id: row.id, sentAt: row.sent_at, created: true };
  }

  const existing = await pool.query<{ id: string; sent_at: Date }>(
    'SELECT id, sent_at FROM nudges WHERE from_user_id = $1 AND client_nudge_id = $2',
    [args.fromUserId, args.clientNudgeId],
  );

  const prior = existing.rows[0];
  if (!prior) {
    // Only reachable if the row was purged between the two statements.
    throw new Error('nudge conflicted but could not be read back');
  }

  return { id: prior.id, sentAt: prior.sent_at, created: false };
};

/**
 * "Seen" means the recipient's client rendered the animation — not that a
 * push was delivered. The distinction is the whole point of the affordance:
 * telling a sender their partner saw a heart when the phone was face-down in
 * a bag is exactly the kind of false signal this product should not create.
 */
export const ackNudge = async (args: {
  nudgeId: string;
  recipientId: string;
}): Promise<{ ackedAt: Date; fromUserId: string } | null> => {
  // The sender comes back from the same UPDATE. Looking it up separately
  // would be a second round trip to learn something the row already knows.
  const { rows } = await pool.query<{ acked_at: Date; from_user_id: string }>(
    `
    UPDATE nudges
       SET acked_at = now()
     WHERE id = $1 AND to_user_id = $2 AND acked_at IS NULL
    RETURNING acked_at, from_user_id
    `,
    [args.nudgeId, args.recipientId],
  );

  const row = rows[0];
  return row ? { ackedAt: row.acked_at, fromUserId: row.from_user_id } : null;
};

/** Recipients who should get a push because no socket of theirs is open. */
export const mutedRecipients = async (args: {
  circleId: string;
  userIds: string[];
}): Promise<Set<string>> => {
  if (args.userIds.length === 0) return new Set();

  const { rows } = await pool.query<{ user_id: string }>(
    `
    SELECT user_id FROM circle_members
     WHERE circle_id = $1
       AND user_id = ANY($2::uuid[])
       AND nudges_muted_until IS NOT NULL
       AND nudges_muted_until > now()
    `,
    [args.circleId, args.userIds],
  );

  return new Set(rows.map((row) => row.user_id));
};
