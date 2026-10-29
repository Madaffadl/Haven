/**
 * EXPO_PUBLIC_DEMO=1: the map runs against the sample circle in
 * ./demoCircle.ts, with no backend and no sign-in. Read in one place so the
 * router and the map cannot disagree about which mode they are in.
 *
 * Must stay a literal `process.env.EXPO_PUBLIC_…` access: Expo inlines it at
 * bundle time and cannot see through indirection.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO === '1';
