import { z } from 'zod';
import { circleId, isoInstant, nudgeId } from './primitives';
import { locationReportSchema, memberPresenceSchema } from './presence';
import { nudgeEventSchema, sendNudgeSchema } from './nudge';
import { trustModeSchema } from './trust';

/**
 * The wire protocol, typed once and shared by both ends. A handler that stops
 * matching this map is a compile error on the server; a client that sends the
 * wrong shape is a compile error in the app.
 */

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

export const socketErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'invalid_payload',
  'rate_limited',
  'stale_report',
  'not_a_member',
  'internal',
]);

export type SocketErrorCode = z.infer<typeof socketErrorCodeSchema>;

export interface SocketError {
  code: SocketErrorCode;
  message: string;
  /** Present on 'rate_limited'. Client must back off, not spin. */
  retryAfterMs?: number;
}

/**
 * Every client→server event is acknowledged. Socket.IO acks are the only
 * backpressure signal we get: without them a client cannot tell "delivered"
 * from "queued on a dead socket", and the offline outbox has nothing to
 * resolve against.
 */
export type Ack<T> = (result: { ok: true; data: T } | { ok: false; error: SocketError }) => void;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * Who a member is, as opposed to where and how they are. Sent with the
 * bootstrap only: it changes rarely, so repeating it in every
 * `presence:update` would be pure payload weight on the hottest event.
 */
export const memberProfileSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1).max(40),
  /** Per-circle override ("Dad" here, "Rizal" elsewhere). Wins when present. */
  nickname: z.string().max(24).nullable(),
  avatarUrl: z.string().nullable(),
  /** The member's own accent: Battery Ring and avatar glow. */
  accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type MemberProfile = z.infer<typeof memberProfileSchema>;

export const presenceBootstrapSchema = z.object({
  circleId,
  profiles: z.array(memberProfileSchema).max(16),
  // Bounded to circles.max_members' ceiling. Every array schema in this
  // package carries a .max(). zod 4.6.6 patched the issue-accumulation OOM
  // (GHSA-mrhx-c7xc-m3w5), but a bound costs nothing and keeps any future
  // validator regression from turning an oversized array into a memory bomb.
  members: z.array(memberPresenceSchema).max(16),
  serverTime: isoInstant,
});

export type PresenceBootstrap = z.infer<typeof presenceBootstrapSchema>;

export const presenceUpdateSchema = z.object({
  circleId,
  member: memberPresenceSchema,
});

export type PresenceUpdate = z.infer<typeof presenceUpdateSchema>;

export const setTrustSchema = z.object({
  /** null = change the global default, cascading to every inheriting circle. */
  circleId: circleId.nullable(),
  mode: trustModeSchema,
  fuzzRadiusM: z.number().int().min(250).max(25_000).optional(),
});

export type SetTrust = z.infer<typeof setTrustSchema>;

/**
 * Server-driven upload cadence. The client does not pick its own interval:
 * the server knows the member's activity, their battery, and whether anyone
 * is even looking at the map, and it is the only party that can trade those
 * off globally. See `docs/02-realtime-and-privacy.md` §4.
 */
export const uploadPolicySchema = z.object({
  intervalMs: z.number().int().min(15_000).max(1_800_000),
  /** Minimum movement before an unscheduled report is worth the radio wake. */
  distanceFilterM: z.number().int().min(0).max(2_000),
  /** Server has no live viewers for this user; drop to the cheapest mode. */
  idle: z.boolean(),
});

export type UploadPolicy = z.infer<typeof uploadPolicySchema>;

// ---------------------------------------------------------------------------
// Event maps
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'location:report': (
    payload: z.input<typeof locationReportSchema>,
    ack: Ack<UploadPolicy>,
  ) => void;
  'nudge:send': (
    payload: z.input<typeof sendNudgeSchema>,
    ack: Ack<{ id: string; sentAt: string }>,
  ) => void;
  'nudge:ack': (payload: { nudgeId: string }, ack: Ack<null>) => void;
  'trust:set': (payload: z.input<typeof setTrustSchema>, ack: Ack<null>) => void;
  /**
   * Cheap liveness ping. Carries battery so a backgrounded phone that is not
   * moving still keeps its context fresh without a GPS fix — the single
   * highest-value, lowest-cost packet in the protocol.
   */
  'presence:heartbeat': (
    payload: { batteryPercent: number; powerSaving: boolean },
    ack: Ack<UploadPolicy>,
  ) => void;
}

export interface ServerToClientEvents {
  /** Full circle state, sent once per circle immediately after connect. */
  'presence:bootstrap': (payload: PresenceBootstrap) => void;
  /** One member changed. Already privacy-projected for this room. */
  'presence:update': (payload: PresenceUpdate) => void;
  /**
   * A member's socket opened or closed. Deliberately tiny and separate from
   * `presence:update`: connects and disconnects are the highest-frequency
   * events in the system (phones sleep, wake, switch wifi→LTE constantly), so
   * they must not cost a presence projection or a database read. The client
   * merges `online` into whatever it already has cached for that member.
   */
  'presence:liveness': (payload: {
    circleId: string;
    userId: string;
    online: boolean;
    at: string;
  }) => void;

  'nudge:received': (payload: z.infer<typeof nudgeEventSchema>) => void;
  'nudge:delivered': (payload: { nudgeId: string; at: string }) => void;

  /**
   * A member changed their Trust Mode in this circle.
   *
   * Client contract: on receipt, immediately DISCARD the cached coordinate
   * for `userId` and render them as resolving. A fresh `presence:bootstrap`
   * follows within the same tick. Waiting for that bootstrap before clearing
   * would leave a precise position on screen after its owner asked to hide
   * it — brief, but exactly the moment the feature exists for.
   */
  'trust:changed': (payload: {
    circleId: string;
    userId: string;
    mode: z.infer<typeof trustModeSchema>;
  }) => void;

  'policy:update': (payload: UploadPolicy) => void;
  error: (payload: SocketError) => void;
}

/** Attached to each socket at authentication time. */
export interface SocketData {
  userId: string;
  deviceId: string;
  sessionId: string;
  /** Circles this socket is joined to; resolved once on connect. */
  circleIds: string[];
}

export const nudgeAckSchema = z.object({ nudgeId });
export type NudgeAck = z.infer<typeof nudgeAckSchema>;

// ---------------------------------------------------------------------------
// Room naming
// ---------------------------------------------------------------------------
// Shared so the server and any future admin tooling agree on the namespace.

export const circleRoom = (id: string): string => `circle:${id}`;
export const userRoom = (id: string): string => `user:${id}`;
