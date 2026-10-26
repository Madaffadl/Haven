import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  MemberPresence,
  ServerToClientEvents,
  SocketData,
} from '@haven/contracts';
import type { MembershipContext } from '../infra/db/repositories/location.js';

/** Socket.IO's inter-server event map; unused, but required by its generics. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export interface ServerSocketData extends SocketData {
  /**
   * Trust Mode + fuzz anchor per circle, loaded once at connect.
   *
   * Re-reading this per location report would put a three-way join on the
   * hottest path in the system, to retrieve data that only changes when
   * someone taps a privacy toggle. Invalidated by the trust handler.
   */
  memberships: MembershipContext[];

  /**
   * Last payload actually broadcast to each circle, for change suppression.
   *
   * Process-local and therefore best-effort: on a different node, or after a
   * restart, the cache misses and we emit one redundant update. That is the
   * correct failure direction — a stale cache can only ever cause an extra
   * packet, never a wrong or missing one.
   */
  lastBroadcast: Map<string, MemberPresence>;
}

export type HavenServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  ServerSocketData
>;

export type HavenSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  ServerSocketData
>;

export interface HandlerContext {
  io: HavenServer;
  socket: HavenSocket;
}
