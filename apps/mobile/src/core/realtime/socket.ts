import type {
  ClientToServerEvents,
  LocationReport,
  SendNudge,
  ServerToClientEvents,
  SocketErrorCode,
  TrustMode,
  UploadPolicy,
} from '@haven/contracts';
import { io, type Socket } from 'socket.io-client';

import { nudgeActions } from '../../state/nudges';
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

  const nudges = nudgeActions();
  client.on('nudge:received', nudges.received);
  client.on('nudge:delivered', nudges.delivered);

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
  nudgeActions().reset();
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
 * An acknowledged request over the socket. Fails fast offline rather than
 * letting Socket.IO buffer it: a nudge or a privacy change that silently
 * lands minutes later, after the screen said it failed, is worse than one
 * that plainly did not happen.
 */
const request = async <T>(
  send: (
    client: HavenClientSocket,
  ) => Promise<
    | { ok: true; data: T }
    | { ok: false; error: { code: SocketErrorCode; message: string; retryAfterMs?: number } }
  >,
): Promise<T> => {
  if (!socket?.connected) throw new RealtimeRequestError('offline', 'not connected');

  let result: Awaited<ReturnType<typeof send>>;
  try {
    result = await send(socket);
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
  return result.data;
};

const TIMEOUT_MS = 10_000;

/** Change this user's Trust Mode in every circle that inherits it. */
export const requestTrustMode = async (mode: TrustMode): Promise<void> => {
  await request<null>((client) =>
    client.timeout(TIMEOUT_MS).emitWithAck('trust:set', { circleId: null, mode }),
  );
};

export const requestLocationReport = (report: LocationReport) =>
  request<UploadPolicy>((client) =>
    client.timeout(TIMEOUT_MS).emitWithAck('location:report', report),
  );

export const requestNudge = (nudge: SendNudge) =>
  request<{ id: string; sentAt: string }>((client) =>
    client.timeout(TIMEOUT_MS).emitWithAck('nudge:send', nudge),
  );

/**
 * "I rendered it": what turns the sender's nudge into "seen". Sent when the
 * animation starts playing, never on receipt, and best effort: a lost ack
 * costs the sender a receipt, not the recipient anything.
 */
export const acknowledgeNudge = (nudgeId: string): void => {
  socket?.emit('nudge:ack', { nudgeId }, () => {});
};
