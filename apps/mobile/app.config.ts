import type { ExpoConfig } from 'expo/config';

/**
 * Dynamic config so secrets come from the environment, never the repo.
 *
 * Haven cannot run in Expo Go: Mapbox's native SDK and (later) the WidgetKit
 * extension both need a development build (`pnpm --filter @haven/mobile ios`).
 */
const config: ExpoConfig = {
  name: 'Haven',
  slug: 'haven',
  scheme: 'haven',
  version: '1.0.0',
  orientation: 'portrait',
  // Dark is the product baseline, not a theme option: the map, the glass and
  // every contrast ratio in src/ui/theme/tokens.ts are tuned for it.
  userInterfaceStyle: 'dark',
  backgroundColor: '#070B1A',
  // The New Architecture is mandatory as of SDK 58 (and required by
  // Reanimated 4), so there is no flag to set.
  ios: {
    bundleIdentifier: 'app.haven.mobile',
    supportsTablet: true,
    infoPlist: {
      // 'location' is added by the expo-location plugin below.
      UIBackgroundModes: ['fetch', 'remote-notification'],
    },
  },
  android: {
    package: 'app.haven.mobile',
    // Edge-to-edge is always on as of SDK 58; safe areas are handled in-app.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION'],
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    ['@rnmapbox/maps', {}],
    [
      'expo-location',
      {
        // Shown by iOS in the permission prompts. Plain words about what the
        // circle gets, and that battery is being looked after.
        locationWhenInUsePermission:
          'Haven shows your circle where you are, so they know you are okay.',
        locationAlwaysAndWhenInUsePermission:
          'Haven keeps your circle up to date while the app is closed, using as little battery as possible.',
        // The same promise under the older key some iOS versions still read.
        locationAlwaysPermission:
          'Haven keeps your circle up to date while the app is closed, using as little battery as possible.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    mapboxToken: process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '',
    apiUrl: process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000',
  },
};

export default config;
