import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { color, radius, size, space } from '../theme/tokens';
import { HText } from './HText';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'quiet';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** primary: the one action on a screen. secondary: an alternative. quiet: a way out. */
  variant?: Variant;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

/**
 * Full-width action button. Primary is the peach fill with ink text, the same
 * pairing verified in test/tokens.test.ts ("ink on peach passes 4.5:1").
 *
 * While loading it keeps its size and label (announced as busy), so the
 * layout does not jump and a second tap cannot send the request twice.
 */
export const Button = ({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  loading = false,
  disabled = false,
  accessibilityHint,
}: ButtonProps) => {
  const ink = variant === 'primary' ? color.text.onAccent : color.text.primary;

  return (
    <PressableScale
      accessibilityLabel={label}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.base, styles[variant]]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={ink} />
        ) : Icon ? (
          <Icon size={size.icon.md} color={ink} strokeWidth={2.25} />
        ) : null}
        <HText
          variant="callout"
          tone={variant === 'quiet' ? 'secondary' : 'primary'}
          style={variant === 'primary' ? { color: ink } : null}
        >
          {label}
        </HText>
      </View>
    </PressableScale>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.pill,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: color.accent.peach },
  secondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: color.glass.border,
  },
  quiet: { minHeight: size.touchMin },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
});
