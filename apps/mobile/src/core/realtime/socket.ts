import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketErrorCode,
  TrustMode,
} from '@haven/contracts';
import { io, type Socket } from 'socket.io-client';

import { presenceActions } from '../../state/presence';

export type HavenClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface ConnectOptions {
  url: string;
  /**
   * Called on every (re)connect rather than once. Access tokens are short-
   * lived; a reconnect after the phone slept for an hour must not present
   * the token it had at launch.
   */
  getToken: () => Promise<string>;
}

let socket: HavenClientSocket | null = null;

/**
 * One socket for the app's lifetime, typed by the shared contract.
 *
 * WebSocket-only, matching the server: long-polling on a mobile radio keeps
 * it awake between polls, which is precisely the battery cost the
 * architecture exists to avoid.
 */
export const connectRealtime = ({ url, getToken }: ConnectOptions): HavenClientSocket => {
  if (socket) return socket;

  const actions = presenceActions();

  const client: HavenClientSocket = io(url, {
    transports: ['websocket'],
    auth: (cb) => {
      // A failed refresh still has to answer, or the handshake hangs forever.
      getToken().then(
        (token) => cb({ token }),
        () => cb({ token: '' }),
      );
    },
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    // Jitter so a server deploy doesn't bring every phone back in the same
    // second — the thundering herd the server's graceful shutdown also guards.
    randomizationFactor: 0.5,
  });

  client.on('presence:bootstrap', actions.bootstrap);
  client.on('presence:update', actions.update);
  client.on('presence:liveness', actions.liveness);
  // Order on the wire is trust:changed then bootstrap; the reducer quarantines
  // the member between the two, so arrival order cannot re-expose them.
  client.on('trust:changed', actions.trustChanged);

  // The server drops our sockets when circle membership changes (joining,
  // creating a circle) so the handshake re-runs against the new membership.
  // Socket.IO treats a server-side disconnect as deliberate and does not
  // reconnect on its own.
  client.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') client.connect();
  });

  socket = client;
  return client;
};

export const disconnectRealtime = (): void => {
  socket?.disconnect();
  socket = null;
  presenceActions().reset();
};

export const getSocket = (): HavenClientSocket | null => socket;

export class RealtimeRequestError extends Error {
  constructor(
    readonly code: SocketErrorCode | 'offline' | 'timeout',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * Change this user's Trust Mode in every circle that inherits it.
 *
 * Fails fast when offline instead of letting Socket.IO buffer the emit. A
 * privacy change that silently lands minutes later, after the screen said it
 * had failed, would be worse than one that plainly did not happen.
 */
export const requestTrustMode = async (mode: TrustMode): Promise<void> => {
  if (!socket?.connected) throw new RealtimeRequestError('offline', 'not connected');

  let result: Parameters<Parameters<ClientToServerEvents['trust:set']>[1]>[0];
  try {
    result = await socket.timeout(10_000).emitWithAck('trust:set', { circleId: null, mode });
  } catch {
    throw new RealtimeRequestError('timeout', 'no answer from the server');
  }

  if (!result.ok) {
    throw new RealtimeRequestError(
      result.error.code,
      result.error.message,
      result.error.retryAfterMs,
    );
  }
};
