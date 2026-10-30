import {
  circleRoom,
  locationReportSchema,
  userRoom,
  type Ack,
  type LocationReport,
  type MemberPresence,
  type UploadPolicy,
} from '@haven/contracts';

import { resolveAnchor } from '../../domain/location/fuzz.js';
import { resolveUploadPolicy } from '../../domain/location/policy.js';
import {
  hasMaterialChange,
  projectPresence,
  type SubjectState,
} from '../../domain/location/project.js';
import {
  appendHistory,
  upsertAnchor,
  upsertLocationState,
  type MembershipContext,
} from '../../infra/db/repositories/location.js';
import { limitLocationReport } from '../../infra/redis/rateLimit.js';
import { logger } from '../../lib/logger.js';
import type { HandlerContext, HavenServer } from '../types.js';

/**
 * The location ingest path.
 *
 * Shape of the pipeline, and the reasoning behind its order:
 *
 *   validate → rate-limit → persist (precise) → project per circle → fan out
 *
 * Projection happens once per *circle*, not once per recipient. This is the
 * load-bearing optimisation in the whole realtime tier, and it falls out of
 * the privacy model: what a viewer may see depends on the (subject, circle)
 * pair, never on the viewer's identity. So a circle of eight costs one
 * fuzzing computation and one room broadcast, not eight of each.
 *
 * The one exception is the subject themselves, who always sees their own
 * precise position. They are excluded from the room broadcast and handled
 * separately — and only their *other* devices need it, since the device that
 * sent the fix already knows where it is.
 */

const toSubjectState = (args: {
  userId: string;
  report: LocationReport;
  stored: {
    capturedAt: Date;
    weatherCode: number | null;
    weatherTempC: number | null;
    weatherIsDay: boolean | null;
    weatherObservedAt: Date | null;
  };
}): SubjectState => ({
  userId: args.userId,
  precise: args.report.coordinate,
  accuracyM: args.report.accuracyM,
  activity: args.report.activity,
  battery: args.report.battery,
  weather:
    args.stored.weatherCode !== null &&
    args.stored.weatherTempC !== null &&
    args.stored.weatherObservedAt !== null
      ? {
          code: args.stored.weatherCode,
          temperatureC: args.stored.weatherTempC,
          isDay: args.stored.weatherIsDay ?? true,
          observedAt: args.stored.weatherObservedAt.toISOString(),
        }
      : null,
  timezone: args.report.timezone,
  capturedAt: args.stored.capturedAt,
});

/**
 * Resolve what this circle should see, writing a new fuzz anchor only when
 * the member has genuinely left their cached cell.
 *
 * `resolveAnchor` is pure; the persistence decision lives here so the spatial
 * logic stays testable without a database.
 */
const projectForCircle = async (args: {
  userId: string;
  subject: SubjectState;
  membership: MembershipContext;
}): Promise<MemberPresence> => {
  const { userId, subject, membership } = args;

  if (membership.mode !== 'approximate' || subject.precise === null) {
    return projectPresence({
      subject,
      mode: membership.mode,
      anchor: null,
      online: true,
    });
  }

  const { anchor, changed } = resolveAnchor({
    precise: subject.precise,
    radiusM: membership.fuzzRadiusM,
    phaseKey: `${userId}:${membership.circleId}`,
    previous: membership.anchor,
  });

  if (changed) {
    await upsertAnchor({ userId, circleId: membership.circleId, anchor });
    // Keep the cached membership in step so the next report compares against
    // what we actually published.
    membership.anchor = anchor;
  }

  return projectPresence({ subject, mode: 'approximate', anchor, online: true });
};

/** Is anyone other than this member currently watching any shared circle? */
const anyLiveViewers = async (
  io: HavenServer,
  userId: string,
  memberships: readonly MembershipContext[],
): Promise<boolean> => {
  for (const { circleId } of memberships) {
    // Cluster-aware via the Redis adapter. Circles are capped at 16 members,
    // so the fan-in here is bounded and small by construction.
    const sockets = await io.in(circleRoom(circleId)).fetchSockets();
    if (sockets.some((s) => s.data.userId !== userId)) return true;
  }

  return false;
};

export interface IngestArgs {
  io: HavenServer;
  userId: string;
  deviceId: string;
  report: LocationReport;
  memberships: MembershipContext[];
  /**
   * The reporting socket's change-suppression cache, or null over HTTP.
   *
   * HTTP reports broadcast every projection. They come from the background
   * task only while the app has no socket (core/location in the app), so the
   * next socket starts with an empty cache and can never suppress against a
   * position the HTTP path already moved past.
   */
  lastBroadcast: Map<string, MemberPresence> | null;
  /** The socket that sent the fix, which already knows it; null over HTTP. */
  senderSocketId: string | null;
}

/**
 * The location pipeline, shared by the socket event (app open) and the HTTP
 * endpoint (background task): persist precise → project per circle → fan out
 * → return the next upload policy. Validation and rate limiting happen in
 * the two callers, before this runs.
 */
export const ingestLocationReport = async (args: IngestArgs): Promise<UploadPolicy> => {
  const { io, userId, deviceId, report, memberships, lastBroadcast, senderSocketId } = args;

  const stored = await upsertLocationState({ userId, deviceId, report });

  const policyFor = async (): Promise<UploadPolicy> =>
    resolveUploadPolicy({
      activity: report.activity,
      batteryPercent: report.battery.percent,
      powerSaving: report.battery.powerSaving,
      hasLiveViewers: await anyLiveViewers(io, userId, memberships),
      fullyGhosted: memberships.length > 0 && memberships.every((m) => m.mode === 'ghost'),
    });

  // No row means an out-of-order report older than what we already hold.
  // Acknowledge it as handled — the client did nothing wrong and must not
  // retry — but broadcast nothing.
  if (!stored) return policyFor();

  void appendHistory({ userId, report }).catch((error: unknown) => {
    // History is a convenience; never fail a live update because the
    // (optional, partitioned) trail could not be written.
    logger.warn({ err: error, userId }, 'failed to append location history');
  });

  const subject = toSubjectState({ userId, report, stored });

  for (const membership of memberships) {
    const presence = await projectForCircle({ userId, subject, membership });

    const previous = lastBroadcast?.get(membership.circleId) ?? null;
    if (lastBroadcast && !hasMaterialChange(previous, presence)) {
      // The common case for a stationary member in Approximate mode: the cell
      // centroid is unchanged and the battery is in the same 5% bucket, so
      // the entire circle's radios stay asleep.
      continue;
    }

    lastBroadcast?.set(membership.circleId, presence);

    io.to(circleRoom(membership.circleId))
      .except(userRoom(userId))
      .emit('presence:update', { circleId: membership.circleId, member: presence });
  }

  // The member's own other devices get the precise position. The sending
  // socket (a socket id is also a room) already knows its own GPS fix.
  const selfView = projectPresence({ subject, mode: 'precise', anchor: null, online: true });
  const ownDevices = senderSocketId
    ? io.to(userRoom(userId)).except(senderSocketId)
    : io.to(userRoom(userId));
  for (const { circleId } of memberships) {
    ownDevices.emit('presence:update', { circleId, member: selfView });
  }

  return policyFor();
};

export const handleLocationReport = async (
  ctx: HandlerContext,
  raw: unknown,
  ack: Ack<UploadPolicy>,
): Promise<void> => {
  const { io, socket } = ctx;
  const userId = socket.data.userId;

  const parsed = locationReportSchema.safeParse(raw);
  if (!parsed.success) {
    ack({ ok: false, error: { code: 'invalid_payload', message: 'malformed location report' } });
    return;
  }

  const limit = await limitLocationReport(userId);
  if (!limit.allowed) {
    ack({
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'too many location reports',
        retryAfterMs: limit.retryAfterMs,
      },
    });
    return;
  }

  const policy = await ingestLocationReport({
    io,
    userId,
    deviceId: socket.data.deviceId,
    report: parsed.data,
    memberships: socket.data.memberships,
    lastBroadcast: socket.data.lastBroadcast,
    senderSocketId: socket.id,
  });

  ack({ ok: true, data: policy });
};
