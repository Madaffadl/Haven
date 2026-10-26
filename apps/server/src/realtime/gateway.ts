import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { redisPub, redisSub } from '../infra/redis/client.js';
import { logger } from '../lib/logger.js';
import { authenticate } from './middleware/authenticate.js';
import { handleLocationReport } from './handlers/location.js';
import { handleNudgeAck, handleSendNudge } from './handlers/nudge.js';
import { handleConnection, handleDisconnect, handleHeartbeat } from './handlers/presence.js';
import { handleSetTrust } from './handlers/trust.js';
import type { HandlerContext, HavenServer, HavenSocket } from './types.js';

/**
 * Wraps a handler so a thrown error becomes a failed ack rather than an
 * unhandled rejection that takes the process down.
 *
 * Socket.IO will happily let a rejected promise escape, and a client whose
 * ack never arrives cannot distinguish "server broke" from "network dropped"
 * — so it retries forever. Every handler must answer, even to say no.
 */
const guard =
  <T>(
    name: string,
    handler: (ctx: HandlerContext, payload: unknown, ack: (r: T) => void) => Promise<void>,
  ) =>
  (ctx: HandlerContext) =>
  (payload: unknown, ack: unknown): void => {
    const respond = typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};

    void handler(ctx, payload, respond as (r: T) => void).catch((error: unknown) => {
      logger.error({ err: error, event: name, userId: ctx.socket.data.userId }, 'handler failed');
      respond({ ok: false, error: { code: 'internal', message: 'something went wrong' } });
    });
  };

export const createGateway = (httpServer: HttpServer): HavenServer => {
  const io: HavenServer = new Server(httpServer, {
    // Mobile networks drop silently; these are tuned for a phone that goes
    // through a tunnel, not a browser tab on wifi.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectionStateRecovery: {
      // Lets a brief disconnect resume without a full re-bootstrap — the
      // single biggest saving on a commuter's data and battery.
      maxDisconnectionDuration: 2 * 60_000,
      skipMiddlewares: false,
    },
    transports: ['websocket'],
    // A location report is well under 1 KB. The 1 MB default lets a single
    // message force a megabyte of JSON parsing and schema validation before
    // anything can reject it.
    maxHttpBufferSize: 16 * 1024,
    adapter: createAdapter(redisPub, redisSub),
  });

  io.use((socket, next) => {
    void authenticate(socket as HavenSocket, next);
  });

  io.on('connection', (socket: HavenSocket) => {
    const ctx: HandlerContext = { io, socket };

    void handleConnection(ctx).catch((error: unknown) => {
      logger.error({ err: error, userId: socket.data.userId }, 'connection setup failed');
      socket.disconnect(true);
    });

    socket.on('location:report', guard('location:report', handleLocationReport)(ctx));
    socket.on('nudge:send', guard('nudge:send', handleSendNudge)(ctx));
    socket.on('nudge:ack', guard('nudge:ack', handleNudgeAck)(ctx));
    socket.on('trust:set', guard('trust:set', handleSetTrust)(ctx));
    socket.on('presence:heartbeat', guard('presence:heartbeat', handleHeartbeat)(ctx));

    socket.on('disconnect', () => {
      void handleDisconnect(ctx).catch((error: unknown) => {
        logger.error({ err: error, userId: socket.data.userId }, 'disconnect cleanup failed');
      });
    });
  });

  return io;
};
