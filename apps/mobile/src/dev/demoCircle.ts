import type { PresenceBootstrap } from '@haven/contracts';

/**
 * A circle to look at before auth and a backend exist (EXPO_PUBLIC_DEMO=1).
 *
 * Shaped exactly like a server bootstrap — already privacy-projected — so the
 * UI is exercised on the same states production produces. Each member shows a
 * different case the map has to handle:
 *
 *   you    precise, charging            → mint arc + bolt, peach outline
 *   rizal  precise, same building       → fanned out next to you
 *   maya   approximate, 1 km, raining   → dashed lavender disc, low battery
 *   dimas  precise, stale, offline      → dimmed, clock badge
 *   oma    ghost                        → list only: no position and no local
 *                                          time (the server withholds the
 *                                          timezone in ghost), but battery and
 *                                          weather still answer "is she okay?"
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const DEMO_SELF_ID = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f01';
export const DEMO_CIRCLE_ID = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f00';

const RIZAL = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f02';
const MAYA = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f03';
const DIMAS = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f04';
const OMA = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f05';

const HOME: [number, number] = [106.8136, -6.2615]; // Kemang, South Jakarta

export const demoBootstrap = (): PresenceBootstrap => ({
  circleId: DEMO_CIRCLE_ID,
  serverTime: new Date().toISOString(),
  profiles: [
    {
      userId: DEMO_SELF_ID,
      displayName: 'You',
      nickname: null,
      avatarUrl: null,
      accentHex: '#FFAD8F',
    },
    {
      userId: RIZAL,
      displayName: 'Rizal Hakim',
      nickname: null,
      avatarUrl: null,
      accentHex: '#7CF5C8',
    },
    {
      userId: MAYA,
      displayName: 'Maya Putri',
      nickname: null,
      avatarUrl: null,
      accentHex: '#B9A7FF',
    },
    { userId: DIMAS, displayName: 'Dimas', nickname: null, avatarUrl: null, accentHex: '#FFD27A' },
    { userId: OMA, displayName: 'Hartini', nickname: 'Oma', avatarUrl: null, accentHex: '#FFB4A2' },
  ],
  members: [
    {
      userId: DEMO_SELF_ID,
      trustMode: 'precise',
      coordinate: HOME,
      radiusM: 8,
      activity: 'still',
      online: true,
      timezone: 'Asia/Jakarta',
      capturedAt: minutesAgo(1),
      battery: { percent: 80, state: 'charging', powerSaving: false },
      weather: { code: 2, temperatureC: 29.2, isDay: true, observedAt: minutesAgo(10) },
    },
    {
      userId: RIZAL,
      trustMode: 'precise',
      coordinate: [HOME[0] + 0.00004, HOME[1] - 0.00003],
      radiusM: 12,
      activity: 'still',
      online: true,
      timezone: 'Asia/Jakarta',
      capturedAt: minutesAgo(3),
      battery: { percent: 65, state: 'unplugged', powerSaving: false },
      weather: { code: 2, temperatureC: 29.2, isDay: true, observedAt: minutesAgo(10) },
    },
    {
      userId: MAYA,
      trustMode: 'approximate',
      // A cell centroid, as the server would send — not her real position.
      coordinate: [106.8227, -6.2297],
      radiusM: 1000,
      activity: 'walking',
      online: true,
      timezone: 'Asia/Jakarta',
      capturedAt: minutesAgo(4),
      battery: { percent: 15, state: 'unplugged', powerSaving: true },
      weather: { code: 63, temperatureC: 24.4, isDay: true, observedAt: minutesAgo(8) },
    },
    {
      userId: DIMAS,
      trustMode: 'precise',
      coordinate: [106.7995, -6.2441],
      radiusM: 65,
      activity: 'unknown',
      online: false,
      timezone: 'Asia/Jakarta',
      capturedAt: minutesAgo(52),
      battery: { percent: 41, state: 'unplugged', powerSaving: false },
      weather: { code: 3, temperatureC: 27.0, isDay: true, observedAt: minutesAgo(55) },
    },
    {
      userId: OMA,
      trustMode: 'ghost',
      activity: 'unknown',
      online: true,
      // No coordinate and no timezone: the server withholds both in ghost.
      capturedAt: minutesAgo(6),
      battery: { percent: 92, state: 'unplugged', powerSaving: false },
      weather: { code: 0, temperatureC: 14.8, isDay: false, observedAt: minutesAgo(20) },
    },
  ],
});
