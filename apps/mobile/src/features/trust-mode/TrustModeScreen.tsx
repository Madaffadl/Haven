import type { TrustMode } from '@haven/contracts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, radius, size, space } from '../../ui/theme/tokens';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { changeTrustMode } from './changeTrustMode';
import { MODE_VISUALS } from './modeVisuals';
import { TRUST_OPTIONS, trustErrorCopy } from './trustCopy';

/**
 * Trust Mode: what your circle sees of you.
 *
 * A tap applies the change, with no separate save step. The selection only
 * moves once the server has confirmed it; until then the tapped option shows
 * a spinner and the old one stays checked, because that is still the truth.
 */
export const TrustModeScreen = () => {
  const router = useRouter();
  const current = useSession((s) => s.trustMode);

  const [pending, setPending] = useState<TrustMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (mode: TrustMode) => {
    if (mode === current || pending) return;
    setPending(mode);
    setError(null);
    try {
      await changeTrustMode(mode);
      void Haptics.selectionAsync();
    } catch (caught) {
      setError(trustErrorCopy(caught));
    } finally {
      setPending(null);
    }
  };

  return (
    <OnboardingScreen
      onBack={() => router.back()}
      title="Trust Mode"
      subtitle="Choose how much your circle sees. You can change it whenever you like."
      footer={<Button variant="secondary" label="Done" onPress={() => router.back()} />}
    >
      <View accessibilityRole="radiogroup" style={styles.options}>
        {TRUST_OPTIONS.map(({ mode, label, summary }) => {
          const selected = mode === current;
          const busy = mode === pending;
          const { icon: Icon, tint } = MODE_VISUALS[mode];

          return (
            <PressableScale
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={`${label}. ${summary}`}
              accessibilityState={{ selected, busy }}
              disabled={pending !== null}
              onPress={() => void choose(mode)}
              style={[styles.option, selected ? { borderColor: tint } : null]}
            >
              <View style={[styles.icon, { backgroundColor: `${tint}26` }]}>
                <Icon size={size.icon.md} color={tint} strokeWidth={2} />
              </View>
              <View style={styles.text}>
                <HText variant="callout">{label}</HText>
                <HText variant="footnote" tone="secondary">
                  {summary}
                </HText>
              </View>
              <View style={styles.state}>
                {busy ? (
                  <ActivityIndicator color={tint} />
                ) : selected ? (
                  <Check size={size.icon.md} color={tint} strokeWidth={2.5} />
                ) : null}
              </View>
            </PressableScale>
          );
        })}
      </View>

      {error ? (
        <HText variant="footnote" style={styles.error} accessibilityLiveRegion="assertive">
          {error}
        </HText>
      ) : null}

      <HText variant="footnote" tone="tertiary">
        Applies to all your circles. Your own map always shows your exact spot, because only you see
        it.
      </HText>
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.glass.border,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  icon: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: size.touchMin / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: space.xxs },
  state: { width: size.icon.lg, alignItems: 'center' },
  error: { color: color.status.critical },
});
