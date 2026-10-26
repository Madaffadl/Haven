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
      NSLocationWhenInUseUsageDescription:
        'Haven shows your circle where you are, so they know you are okay.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Haven keeps your circle up to date in the background, using as little battery as possible.',
      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
    },
  },
  android: {
    package: 'app.haven.mobile',
    // Edge-to-edge is always on as of SDK 58; safe areas are handled in-app.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION'],
  },
  plugins: ['expo-router', 'expo-font', 'expo-secure-store', ['@rnmapbox/maps', {}]],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    mapboxToken: process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '',
    apiUrl: process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000',
  },
};

export default config;
