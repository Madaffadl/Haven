import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { connectRealtime, disconnectRealtime } from '../../core/realtime/socket';
import { DEMO_CIRCLE_ID, DEMO_SELF_ID, demoBootstrap } from '../../dev/demoCircle';
import { presenceActions } from '../../state/presence';
import { useSession } from '../../state/session';
import { HText } from '../../ui/primitives/HText';
import { color, space } from '../../ui/theme/tokens';
import { LiveContextMap } from './LiveContextMap';
import { MemberSheet, useSheetHeights } from './MemberSheet';

const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';
const API_URL = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '';

/**
 * The app's main (and, in v1.0, only real) screen: map behind, sheet in front.
 *
 * Owns the two pieces of state the map and the sheet coordinate on —
 * selection and sheet height — so neither has to know about the other.
 */
export const MapScreen = () => {
  const session = useSession((s) => s.session);
  const insets = useSafeAreaInsets();
  const heights = useSheetHeights();

  const circleId = DEMO ? DEMO_CIRCLE_ID : session?.circleId;
  const selfId = DEMO ? DEMO_SELF_ID : session?.userId;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    if (DEMO) {
      presenceActions().bootstrap(demoBootstrap());
      return undefined;
    }
    if (!session) return undefined;

    connectRealtime({
      url: API_URL,
      getToken: async () => (await SecureStore.getItemAsync('haven.accessToken')) ?? '',
    });
    return () => disconnectRealtime();
  }, [session]);

  // Selecting someone opens the sheet to half, where their detail fits;
  // clearing the selection returns it to peek so the map is unobstructed.
  const select = useCallback((userId: string | null) => {
    setSelectedId(userId);
    setSheetIndex(userId ? 1 : 0);
  }, []);

  if (!circleId || !selfId) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + space.xl }]}>
        <HText variant="title">Haven</HText>
        <HText variant="body" tone="secondary">
          Sign in to see your circle.
        </HText>
      </View>
    );
  }

  // The camera pads by the sheet's visible height, capped at half: at full
  // the map sits under the scrim, so re-centring for it would be wasted motion.
  const visibleSheet = (heights[Math.min(sheetIndex, 1)] ?? 0) + insets.bottom;

  return (
    <View style={styles.root}>
      <LiveContextMap
        circleId={circleId}
        selfId={selfId}
        selectedId={selectedId}
        onSelect={select}
        bottomInset={visibleSheet}
      />
      <MemberSheet
        circleId={circleId}
        selectedId={selectedId}
        onSelect={select}
        index={sheetIndex}
        onIndexChange={setSheetIndex}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  empty: {
    flex: 1,
    gap: space.xs,
    paddingHorizontal: space.lg,
    backgroundColor: color.background,
  },
});
