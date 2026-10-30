import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, radius, size, space } from '../../ui/theme/tokens';

/** A titled group of rows, in the same faint card the member tiles use. */
export const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <View style={styles.section}>
    <HText variant="caption" tone="tertiary" style={styles.sectionTitle} accessibilityRole="header">
      {title.toUpperCase()}
    </HText>
    <View style={styles.card}>{children}</View>
  </View>
);

interface SettingsRowProps {
  icon: LucideIcon;
  label: string;
  /** Current value, shown on the right ("Approximate", "2 of 8"). */
  value?: string;
  onPress?: () => void;
  /** chevron: opens something. check: the selected option in a list. */
  accessory?: 'chevron' | 'check' | null;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
}

export const SettingsRow = ({
  icon: Icon,
  label,
  value,
  onPress,
  accessory = onPress ? 'chevron' : null,
  destructive = false,
  disabled = false,
  busy = false,
}: SettingsRowProps) => {
  const tint = destructive ? color.status.critical : color.text.primary;

  return (
    <PressableScale
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ selected: accessory === 'check', busy }}
      disabled={disabled || !onPress || busy}
      {...(onPress ? { onPress } : {})}
      style={styles.row}
    >
      <Icon size={size.icon.md} color={destructive ? tint : color.text.secondary} strokeWidth={2} />
      <HText variant="body" style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </HText>
      {value ? (
        <HText variant="footnote" tone="secondary" numberOfLines={1} style={styles.value}>
          {value}
        </HText>
      ) : null}
      {busy ? (
        <ActivityIndicator color={color.text.secondary} />
      ) : accessory === 'check' ? (
        <Check size={size.icon.md} color={color.accent.peach} strokeWidth={2.5} />
      ) : accessory === 'chevron' ? (
        <ChevronRight size={size.icon.md} color={color.text.tertiary} strokeWidth={2} />
      ) : null}
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  section: { gap: space.xs },
  sectionTitle: { letterSpacing: 0.8, marginLeft: space.xxs },
  card: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.glass.border,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.glass.border,
  },
  label: { flex: 1 },
  value: { maxWidth: '45%' },
});
