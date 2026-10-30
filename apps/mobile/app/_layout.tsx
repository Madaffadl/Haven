// Per-weight subpaths, not the package index: the index references all 18
// Inter weights and italics, and Metro bundles every one (6.1 MB measured in
// an export) though the type scale only ever uses these four.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { restoreSession } from '../src/core/api/account';
// For its side effect: the background location task must be defined before
// the OS can deliver an event to it, including on a background relaunch.
import '../src/core/location/tracker';
import { DEMO_MODE } from '../src/dev/demoMode';
import { selectStage, useSession } from '../src/state/session';
import { STAGE_HOME } from '../src/state/sessionReducer';
import { color } from '../src/ui/theme/tokens';

void SplashScreen.preventAutoHideAsync();

/**
 * Providers and route guards only — routing files hold no product logic
 * (docs/01 §3).
 *
 * The splash stays up until Inter has loaded and the stored session has been
 * checked. Rendering first would shift every label once fonts swap in, and
 * flash the sign-in screen at someone who is already signed in.
 *
 * Which group is reachable is decided by one value, the session stage
 * (state/sessionReducer.ts). When it changes, say from 'auth' to 'circle'
 * after a code is verified, the screen that just became unreachable is
 * replaced by that stage's home (STAGE_HOME), so the auth screens never
 * navigate forward themselves. The redirect is explicit: the default target
 * is the navigator's anchor, "/", which is itself guarded before sign-in.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const stage = useSession(selectStage);
  const home = DEMO_MODE ? '/' : STAGE_HOME[stage];

  useEffect(() => {
    if (!DEMO_MODE) void restoreSession();
  }, []);

  const ready = (fontsLoaded || fontError !== null) && (DEMO_MODE || stage !== 'restoring');

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.background },
            animation: 'fade',
          }}
        >
          <Stack.Protected guard={DEMO_MODE || stage === 'app'} redirectTo={home}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected
            guard={!DEMO_MODE && (stage === 'name' || stage === 'circle')}
            redirectTo={home}
          >
            <Stack.Screen name="(onboarding)" />
          </Stack.Protected>
          <Stack.Protected guard={!DEMO_MODE && stage === 'auth'} redirectTo={home}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={!DEMO_MODE && stage === 'unreachable'} redirectTo={home}>
            <Stack.Screen name="unreachable" />
          </Stack.Protected>
          {/* Reachable at every stage: it sorts out sign-in itself. */}
          <Stack.Protected guard={!DEMO_MODE} redirectTo={home}>
            <Stack.Screen name="join/[code]" options={{ animation: 'slide_from_bottom' }} />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
});
