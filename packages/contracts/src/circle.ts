import { z } from 'zod';
import { circleId, isoInstant } from './primitives';

/** Mirrors the `circle_kind` enum. */
export const circleKindSchema = z.enum(['couple', 'family', 'friends']);

export type CircleKind = z.infer<typeof circleKindSchema>;

/**
 * Seats per kind, written to `circles.max_members` at creation. A couple is
 * two people by definition; families and friends stop at the ~8 avatars the
 * map can show legibly.
 */
export const CIRCLE_SEATS: Record<CircleKind, number> = {
  couple: 2,
  family: 8,
  friends: 8,
};

export const memberRoleSchema = z.enum(['owner', 'admin', 'member']);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export const createCircleSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: circleKindSchema,
});

export type CreateCircle = z.infer<typeof createCircleSchema>;

export const circleSummarySchema = z.object({
  id: circleId,
  name: z.string(),
  kind: circleKindSchema,
  role: memberRoleSchema,
  memberCount: z.number().int().nonnegative(),
  maxMembers: z.number().int().positive(),
});

export type CircleSummary = z.infer<typeof circleSummarySchema>;

/** Bounded like every array in contracts; nobody is in 32 circles. */
export const circleListSchema = z.array(circleSummarySchema).max(32);

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/**
 * Six characters from an alphabet with no O/0/I/1, because codes get read
 * aloud across a kitchen. Must match the CHECK on `circle_invites.code`.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;

/** Accepts what people actually type: lower case, stray spaces. */
export const inviteCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/));

export const inviteSchema = z.object({
  code: z.string(),
  circleId,
  maxUses: z.number().int().positive(),
  expiresAt: isoInstant,
});

export type Invite = z.infer<typeof inviteSchema>;

/**
 * What the invitee sees before joining. Joining shares their location, so
 * they must know with whom before they tap, not after.
 */
export const invitePreviewSchema = z.object({
  circleId,
  circleName: z.string(),
  kind: circleKindSchema,
  inviterName: z.string(),
  memberCount: z.number().int().nonnegative(),
  maxMembers: z.number().int().positive(),
  alreadyMember: z.boolean(),
});

export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const acceptInviteResultSchema = z.object({
  circle: circleSummarySchema,
  /** False when they were already a member: accepting twice is harmless. */
  joined: z.boolean(),
});

export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;
