import type { NudgeKind } from '@haven/contracts';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, radius, size, space } from '../../ui/theme/tokens';
import { NUDGES, nudgeErrorCopy, sendLabel } from './nudgeCopy';
import { sendNudge } from './sendNudge';

interface NudgeBarProps {
  circleId: string;
  toUserId: string;
  /** Spoken in each button's label: "Send a heart to Maya". */
  name: string;
}

/**
 * Tap-to-Nudge: one tap, no typing, no read receipts to stare at. Sits at
 * the top of a member's detail, so it is reachable with the sheet at half.
 *
 * Only the tapped button shows progress. Dimming the whole row on every tap
 * would make it flicker; extra taps while one is in flight are ignored.
 */
export const NudgeBar = ({ circleId, toUserId, name }: NudgeBarProps) => {
  const [busy, setBusy] = useState<NudgeKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (kind: NudgeKind) => {
    if (busy) return;
    void Haptics.selectionAsync();
    setBusy(kind);
    setError(null);
    try {
      await sendNudge({ circleId, toUserId, kind });
    } catch (caught) {
      setError(nudgeErrorCopy(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <HText variant="caption" tone="tertiary" style={styles.label}>
        SEND A NUDGE
      </HText>
      <View style={styles.row}>
        {NUDGES.map(({ kind, emoji }) => (
          <PressableScale
            key={kind}
            accessibilityLabel={sendLabel(kind, name)}
            accessibilityState={{ busy: busy === kind }}
            onPress={() => void send(kind)}
            style={styles.button}
          >
            {busy === kind ? (
              <ActivityIndicator color={color.text.secondary} />
            ) : (
              <HText style={styles.emoji} scale="chrome" accessible={false}>
                {emoji}
              </HText>
            )}
          </PressableScale>
        ))}
      </View>
      {error ? (
        <HText variant="footnote" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </HText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: space.xs, marginBottom: space.md },
  label: { letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: space.xs },
  button: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: size.marker,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.glass.border,
  },
  emoji: { fontSize: 24, lineHeight: 30 },
  error: { color: color.status.critical },
});
