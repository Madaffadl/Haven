import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut } from '../../core/api/account';
import { API_URL, api } from '../../core/api';
import { connectRealtime, disconnectRealtime } from '../../core/realtime/socket';
import { DEMO_CIRCLE_ID, DEMO_SELF_ID, demoBootstrap } from '../../dev/demoCircle';
import { DEMO_MODE } from '../../dev/demoMode';
import { presenceActions } from '../../state/presence';
import { useSession } from '../../state/session';
import { color, space } from '../../ui/theme/tokens';
import { TrustChip } from '../trust-mode/TrustChip';
import { LiveContextMap } from './LiveContextMap';
import { MemberSheet, useSheetHeights } from './MemberSheet';

/**
 * The app's main (and, in v1.0, only real) screen: map behind, sheet in front.
 *
 * Owns the two pieces of state the map and the sheet coordinate on —
 * selection and sheet height — so neither has to know about the other.
 */
export const MapScreen = () => {
  const router = useRouter();
  const userId = useSession((s) => s.me?.userId);
  const activeCircleId = useSession((s) => s.activeCircleId);
  const trustMode = useSession((s) => s.trustMode);
  const insets = useSafeAreaInsets();
  const heights = useSheetHeights();

  const circleId = DEMO_MODE ? DEMO_CIRCLE_ID : activeCircleId;
  const selfId = DEMO_MODE ? DEMO_SELF_ID : userId;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  // One socket per signed-in user, not per circle on screen: it joins every
  // circle the user is in, so switching circles needs no reconnect.
  useEffect(() => {
    if (DEMO_MODE) {
      presenceActions().bootstrap(demoBootstrap());
      return undefined;
    }
    if (!userId) return undefined;

    connectRealtime({ url: API_URL, getToken: async () => (await api.accessToken()) ?? '' });
    return () => disconnectRealtime();
  }, [userId]);

  // Selecting someone opens the sheet to half, where their detail fits;
  // clearing the selection returns it to peek so the map is unobstructed.
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setSheetIndex(id ? 1 : 0);
  }, []);

  // The router only shows this screen once there is a user and a circle.
  if (!circleId || !selfId) return null;

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
        selfTrustMode={trustMode}
      />
      <View style={[styles.chip, { top: insets.top + space.xs }]}>
        <TrustChip onPress={() => router.push('/trust')} />
      </View>
      <MemberSheet
        circleId={circleId}
        selectedId={selectedId}
        onSelect={select}
        index={sheetIndex}
        onIndexChange={setSheetIndex}
        // The demo circle has no backend to invite into or sign out of.
        {...(DEMO_MODE
          ? {}
          : { onInvite: () => router.push('/invite'), onSignOut: () => void signOut() })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  chip: { position: 'absolute', right: space.md },
});
