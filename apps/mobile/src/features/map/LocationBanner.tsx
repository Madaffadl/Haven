import { MapPinOff, Navigation } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { turnOnLocation } from '../../core/location/useLocationSharing';
import { useLocationAccess } from '../../state/location';
import { Button } from '../../ui/primitives/Button';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { color, size, space } from '../../ui/theme/tokens';

/**
 * Asks for location in context, on the map where it makes sense, rather than
 * as a cold system prompt at launch. Once location is on, the banner is gone.
 * Calm in both states: nothing is broken, the circle just can't see you yet.
 */
export const LocationBanner = () => {
  const access = useLocationAccess((s) => s.access);
  const [busy, setBusy] = useState(false);

  if (access !== 'undetermined' && access !== 'denied') return null;

  const undetermined = access === 'undetermined';
  const Icon = undetermined ? Navigation : MapPinOff;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.row}>
        <Icon size={size.icon.md} color={color.accent.peach} strokeWidth={2} />
        <View style={styles.text}>
          <HText variant="callout">
            {undetermined ? 'Share your location' : 'Location is off'}
          </HText>
          <HText variant="footnote" tone="secondary">
            {undetermined
              ? 'Your circle sees you on the map once this is on. Choose "Always" so they can while Haven is closed.'
              : "Your circle can't see where you are. You can turn location on in Settings."}
          </HText>
        </View>
      </View>
      <Button
        variant="secondary"
        label={undetermined ? 'Turn on' : 'Open Settings'}
        loading={busy}
        onPress={() => {
          if (!undetermined) {
            void Linking.openSettings();
            return;
          }
          setBusy(true);
          turnOnLocation().finally(() => setBusy(false));
        }}
      />
    </GlassPanel>
  );
};

const styles = StyleSheet.create({
  panel: { padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  text: { flex: 1, gap: space.xxs },
});
