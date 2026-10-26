import {
  circleRoom,
  userRoom,
  type Ack,
  type PresenceBootstrap,
  type UploadPolicy,
} from '@haven/contracts';

import { resolveUploadPolicy } from '../../domain/location/policy.js';
import {
  bootstrapPresence,
  getLiveMemberIds,
  type BootstrapMember,
} from '../../infra/db/repositories/circle.js';
import {
  markOffline,
  markOnline,
  onlineStatuses,
  refreshPresence,
} from '../../infra/redis/presence.js';
import { logger } from '../../lib/logger.js';
import type { HandlerContext, HavenServer } from '../types.js';

/**
 * The one place a bootstrap payload is assembled, so the two emit sites
 * cannot drift — they already did once, when profiles were left out of both.
 * `isStale` is dropped: the client derives staleness from `capturedAt`
 * against its own clock, which stays correct while the app sits open.
 */
const toBootstrap = (circleId: string, members: BootstrapMember[]): PresenceBootstrap => ({
  circleId,
  members: members.map((m) => m.presence),
  profiles: members.map(({ profile }) => ({
    userId: profile.userId,
    displayName: profile.displayName,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    accentHex: profile.accentHex,
  })),
  serverTime: new Date().toISOString(),
});

/**
 * Send every live socket in a circle a bootstrap built for *its own viewer*.
 *
 * Per-viewer is not optional. A single room-wide bootstrap would have to be
 * built from some one member's perspective, and that member sees their own
 * precise position — so broadcasting it would hand everyone else the exact
 * coordinates of whoever we happened to build it for.
 *
 * O(members) queries, which is affordable precisely because this only runs on
 * rare events (a Trust Mode change), never on the location path.
 */
export const rebroadcastCircle = async (io: HavenServer, circleId: string): Promise<void> => {
  const sockets = await io.in(circleRoom(circleId)).fetchSockets();
  if (sockets.length === 0) return;

  const memberIds = [...new Set(sockets.map((s) => s.data.userId))];
  const online = await onlineStatuses(memberIds);

  await Promise.all(
    sockets.map(async (target) => {
      const members = await bootstrapPresence({
        viewerId: target.data.userId,
        circleId,
        online,
      });
      target.emit('presence:bootstrap', toBootstrap(circleId, members));
    }),
  );
};

export const handleConnection = async (ctx: HandlerContext): Promise<void> => {
  const { socket } = ctx;
  const userId = socket.data.userId;

  await socket.join(userRoom(userId));
  await Promise.all(socket.data.circleIds.map((id) => socket.join(circleRoom(id))));

  const becameOnline = await markOnline(userId, socket.id);

  // Bootstrap each circle from this viewer's perspective.
  for (const circleId of socket.data.circleIds) {
    const online = await onlineStatuses(await getLiveMemberIds(circleId));
    const members = await bootstrapPresence({ viewerId: userId, circleId, online });

    socket.emit('presence:bootstrap', toBootstrap(circleId, members));

    // Tell everyone else they came online — a 60-byte event, not a projection.
    if (becameOnline) {
      socket.to(circleRoom(circleId)).emit('presence:liveness', {
        circleId,
        userId,
        online: true,
        at: new Date().toISOString(),
      });
    }
  }

  logger.debug({ userId, circles: socket.data.circleIds.length }, 'socket connected');
};

export const handleDisconnect = async (ctx: HandlerContext): Promise<void> => {
  const { socket } = ctx;
  const userId = socket.data.userId;

  const wentOffline = await markOffline(userId, socket.id);
  if (!wentOffline) return; // Another device of theirs is still connected.

  const at = new Date().toISOString();
  for (const circleId of socket.data.circleIds) {
    socket.to(circleRoom(circleId)).emit('presence:liveness', {
      circleId,
      userId,
      online: false,
      at,
    });
  }
};

/**
 * Heartbeat.
 *
 * The cheapest and most valuable packet in the protocol: it refreshes the
 * presence TTL and updates battery without taking a GPS fix. A phone sitting
 * on a desk should keep its context fresh — "92%, charging" is most of what
 * a worried partner wants — at a cost of one small write and no radio-heavy
 * location work at all.
 */
export const handleHeartbeat = async (
  ctx: HandlerContext,
  raw: unknown,
  ack: Ack<UploadPolicy>,
): Promise<void> => {
  const { socket } = ctx;

  const batteryPercent =
    typeof (raw as { batteryPercent?: unknown })?.batteryPercent === 'number'
      ? (raw as { batteryPercent: number }).batteryPercent
      : null;
  const powerSaving = Boolean((raw as { powerSaving?: unknown })?.powerSaving);

  await refreshPresence(socket.data.userId);

  ack({
    ok: true,
    data: resolveUploadPolicy({
      activity: 'unknown',
      batteryPercent,
      powerSaving,
      // A heartbeat is not the moment to pay for a cluster-wide socket scan;
      // the next location report resolves the real policy.
      hasLiveViewers: true,
      fullyGhosted: socket.data.memberships.every((m) => m.mode === 'ghost'),
    }),
  });
};
