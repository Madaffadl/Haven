import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { color, fontFamily, maxFontScale, radius, space, typeScale } from '../theme/tokens';
import { HText } from './HText';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  /** Always visible above the field: a placeholder alone vanishes as you type. */
  label: string;
  /** Shown under the field and announced with it. */
  error?: string | null;
  /** Large, spaced, centred digits for one-time codes. */
  code?: boolean;
}

/**
 * The only text input in the app, on the same terms as HText: Inter, the type
 * scale, the Dynamic Type cap, and a dark keyboard so the bright system
 * keyboard does not flash up under a midnight screen.
 */
export const TextField = ({
  label,
  error,
  code = false,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) => {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <HText variant="footnote" tone="secondary">
        {label}
      </HText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        allowFontScaling
        maxFontSizeMultiplier={maxFontScale.content}
        keyboardAppearance="dark"
        placeholderTextColor={color.text.tertiary}
        selectionColor={color.accent.peach}
        cursorColor={color.accent.peach}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          code ? styles.code : null,
          focused ? styles.focused : null,
          error ? styles.invalid : null,
        ]}
        {...rest}
      />
      {error ? (
        <HText variant="footnote" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </HText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.glass.border,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: color.text.primary,
    fontSize: typeScale.callout.fontSize,
    fontFamily: fontFamily.medium,
  },
  code: {
    minHeight: 64,
    textAlign: 'center',
    fontSize: typeScale.display.fontSize,
    fontFamily: fontFamily.semibold,
    letterSpacing: 10,
    fontVariant: ['tabular-nums'],
  },
  focused: { borderColor: color.accent.peach },
  invalid: { borderColor: color.status.critical },
  error: { color: color.status.critical },
});
