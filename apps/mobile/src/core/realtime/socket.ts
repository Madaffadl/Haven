import type { ClientToServerEvents, ServerToClientEvents } from '@haven/contracts';
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
      void getToken().then((token) => cb({ token }));
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

  socket = client;
  return client;
};

export const disconnectRealtime = (): void => {
  socket?.disconnect();
  socket = null;
  presenceActions().reset();
};

export const getSocket = (): HavenClientSocket | null => socket;
