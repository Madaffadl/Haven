import { userRoom } from '@haven/contracts';

import { rebroadcastCircle } from './handlers/presence.js';
import type { HavenServer } from './types.js';

/**
 * Bring live sockets up to date after a REST call changed who is in a circle.
 *
 * A socket resolves its circles and their Trust Mode once, in the handshake
 * (middleware/authenticate.ts), and caches them for its lifetime. After a
 * join or a new circle that cache is wrong, so the user's sockets are
 * disconnected and the client reconnects, re-running the handshake against
 * the new membership. Disconnecting works across the whole cluster through
 * the Redis adapter; patching socket state in place would only reach sockets
 * on this node.
 *
 * Everyone already in the circle then gets a fresh bootstrap, which is how
 * the newcomer's avatar and profile reach their maps.
 */
export const resyncMembership = async (
  io: HavenServer,
  userId: string,
  circleId: string,
): Promise<void> => {
  io.in(userRoom(userId)).disconnectSockets();
  await rebroadcastCircle(io, circleId);
};
