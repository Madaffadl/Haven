import type { Activity, BatteryState, MemberPresence, TrustMode } from '@haven/contracts';
import { pool } from '../pool.js';

interface PresenceRow {
  user_id: string;
  display_name: string;
  nickname: string | null;
  avatar_url: string | null;
  accent_hex: string;
  trust_mode: TrustMode;
  lon: number | null;
  lat: number | null;
  radius_m: number | null;
  battery_percent: number | null;
  battery_state: BatteryState;
  power_saving: boolean;
  weather_code: number | null;
  weather_temp_c: number | null;
  weather_is_day: boolean | null;
  weather_observed_at: Date | null;
  timezone: string | null;
  activity: Activity;
  captured_at: Date | null;
  is_stale: boolean;
}

/** Display fields the socket payload doesn't carry but the bootstrap does. */
export interface PresenceProfile {
  userId: string;
  displayName: string;
  nickname: string | null;
  avatarUrl: string | null;
  accentHex: string;
  isStale: boolean;
}

export interface BootstrapMember {
  presence: MemberPresence;
  profile: PresenceProfile;
}

/**
 * Full circle state for one viewer.
 *
 * Delegates entirely to `haven_circle_presence()` — the SECURITY DEFINER
 * function that is the only sanctioned reader of `location_states.geom`.
 * Writing the join here instead would be the exact mistake migration 0008's
 * column grants exist to make impossible.
 */
export const bootstrapPresence = async (args: {
  viewerId: string;
  circleId: string;
  online: Map<string, boolean>;
}): Promise<BootstrapMember[]> => {
  const { rows } = await pool.query<PresenceRow>('SELECT * FROM haven_circle_presence($1, $2)', [
    args.viewerId,
    args.circleId,
  ]);

  return rows.map((row) => {
    const hasPosition = row.lon !== null && row.lat !== null && row.radius_m !== null;

    const presence: MemberPresence = {
      userId: row.user_id,
      trustMode: row.trust_mode,
      activity: row.activity,
      online: args.online.get(row.user_id) ?? false,
      ...(hasPosition
        ? {
            coordinate: [row.lon as number, row.lat as number] satisfies [number, number],
            radiusM: row.radius_m as number,
          }
        : {}),
      ...(row.battery_percent !== null
        ? {
            battery: {
              percent: row.battery_percent,
              state: row.battery_state,
              powerSaving: row.power_saving,
            },
          }
        : {}),
      ...(row.weather_code !== null && row.weather_temp_c !== null && row.weather_observed_at
        ? {
            weather: {
              code: row.weather_code,
              temperatureC: row.weather_temp_c,
              isDay: row.weather_is_day ?? true,
              observedAt: row.weather_observed_at.toISOString(),
            },
          }
        : {}),
      ...(row.timezone ? { timezone: row.timezone } : {}),
      ...(row.captured_at ? { capturedAt: row.captured_at.toISOString() } : {}),
    };

    return {
      presence,
      profile: {
        userId: row.user_id,
        displayName: row.display_name,
        nickname: row.nickname,
        avatarUrl: row.avatar_url,
        accentHex: row.accent_hex,
        isStale: row.is_stale,
      },
    };
  });
};

export const getLiveMemberIds = async (circleId: string): Promise<string[]> => {
  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM circle_members WHERE circle_id = $1 AND left_at IS NULL',
    [circleId],
  );
  return rows.map((row) => row.user_id);
};

export const isMember = async (userId: string, circleId: string): Promise<boolean> => {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM circle_members WHERE user_id = $1 AND circle_id = $2 AND left_at IS NULL',
    [userId, circleId],
  );
  return (rowCount ?? 0) > 0;
};
