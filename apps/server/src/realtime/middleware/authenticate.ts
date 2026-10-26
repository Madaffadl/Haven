import type { ExtendedError } from 'socket.io';
import { pool } from '../../infra/db/pool.js';
import { getMembershipContext } from '../../infra/db/repositories/location.js';
import { verifyAccessToken } from '../../lib/token.js';
import type { HavenSocket } from '../types.js';

/**
 * Authenticate the socket, then resolve everything the connection needs for
 * its whole lifetime in one database round trip.
 *
 * The session is re-checked against the database rather than trusted from the
 * token alone. An access token is valid for minutes; "remove this device"
 * must take effect in seconds, and for a location-sharing app that gap is the
 * difference between a revoked phone being cut off and it continuing to watch
 * the map. The cost is one indexed lookup per connect, not per message.
 */
export const authenticate = async (
  socket: HavenSocket,
  next: (err?: ExtendedError) => void,
): Promise<void> => {
  try {
    const token = socket.handshake.auth?.['token'];
    if (typeof token !== 'string' || token.length === 0) {
      next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
      return;
    }

    const claims = verifyAccessToken(token);
    if (!claims) {
      next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
      return;
    }

    // Widget tokens are read-only and must not hold a socket: the widget polls
    // a REST endpoint on an OS-controlled schedule. Letting one connect would
    // mean a background process holding an open socket indefinitely.
    if (claims.scope !== 'app') {
      next(Object.assign(new Error('forbidden'), { data: { code: 'forbidden' } }));
      return;
    }

    const { rows } = await pool.query<{ ok: boolean }>(
      `
      SELECT true AS ok
        FROM auth_sessions s
        JOIN devices d ON d.id = s.device_id
        JOIN users   u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.user_id = $2
         AND s.device_id = $3
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND d.revoked_at IS NULL
         AND u.deleted_at IS NULL
      `,
      [claims.sid, claims.sub, claims.did],
    );

    if (rows.length === 0) {
      next(Object.assign(new Error('unauthenticated'), { data: { code: 'unauthenticated' } }));
      return;
    }

    const memberships = await getMembershipContext(claims.sub);

    socket.data.userId = claims.sub;
    socket.data.deviceId = claims.did;
    socket.data.sessionId = claims.sid;
    socket.data.circleIds = memberships.map((m) => m.circleId);
    socket.data.memberships = memberships;
    socket.data.lastBroadcast = new Map();

    next();
  } catch (error) {
    next(Object.assign(new Error('internal'), { data: { code: 'internal' } }));
  }
};
