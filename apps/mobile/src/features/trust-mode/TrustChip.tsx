import { StyleSheet, View } from 'react-native';

import { useSession } from '../../state/session';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { size, space } from '../../ui/theme/tokens';
import { MODE_VISUALS } from './modeVisuals';
import { trustLabel } from './trustCopy';

/**
 * The quick way into Trust Mode, pinned over the map. It always shows what
 * you are sharing right now, so "am I hidden?" is answered without a tap.
 */
export const TrustChip = ({ onPress }: { onPress: () => void }) => {
  const mode = useSession((s) => s.trustMode);
  const { icon: Icon, tint } = MODE_VISUALS[mode];
  const label = trustLabel(mode);

  return (
    <PressableScale
      accessibilityLabel={`Trust Mode: ${label}`}
      accessibilityHint="Choose how much your circle sees"
      onPress={onPress}
    >
      <GlassPanel rounded="pill" style={styles.chip}>
        <View style={styles.row}>
          <Icon size={size.icon.sm} color={tint} strokeWidth={2.25} />
          <HText variant="footnote" scale="chrome" style={{ color: tint }}>
            {label}
          </HText>
        </View>
      </GlassPanel>
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  chip: {
    minHeight: size.touchMin,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
