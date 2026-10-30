import { StyleSheet, View } from 'react-native';

import { DEMO_CIRCLE_ID, DEMO_SELF_ID } from '../../dev/demoCircle';
import { DEMO_MODE } from '../../dev/demoMode';
import { usePresence } from '../../state/presence';
import { useSession } from '../../state/session';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, size } from '../../ui/theme/tokens';
import { initialsColor, initialsOf } from '../map/presenceCopy';

/**
 * Your own avatar in the map's top-left corner, opposite the Trust Mode chip:
 * the way into profile and settings. It wears your accent, so changing your
 * colour is visible the moment you get back to the map.
 */
export const ProfileButton = ({ onPress }: { onPress: () => void }) => {
  const me = useSession((s) => s.me);
  const demoSelf = usePresence((s) => s.circles[DEMO_CIRCLE_ID]?.profiles[DEMO_SELF_ID]);

  const name = (DEMO_MODE ? demoSelf?.displayName : me?.displayName) ?? '';
  const accent = (DEMO_MODE ? demoSelf?.accentHex : me?.accentHex) ?? color.accent.peach;

  return (
    <PressableScale accessibilityLabel="Profile and settings" onPress={onPress}>
      <View style={[styles.avatar, { backgroundColor: accent }]}>
        <HText variant="footnote" scale="chrome" style={{ color: initialsColor(accent) }}>
          {initialsOf(name || '?')}
        </HText>
      </View>
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  avatar: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: size.touchMin / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // The same midnight separation the map markers get from labels beneath.
    borderWidth: 2,
    borderColor: color.scrim,
  },
});
