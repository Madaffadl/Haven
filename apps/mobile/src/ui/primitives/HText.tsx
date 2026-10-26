import { Text, type TextProps } from 'react-native';

import { color, maxFontScale, typeScale, type TypeVariant } from '../theme/tokens';

type Tone = keyof typeof color.text | keyof typeof color.accent;

interface HTextProps extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  /**
   * Fixed-width digits. Required for anything that ticks — battery %,
   * temperature, "12 min ago" — or the label jitters as digits change width.
   */
  tabular?: boolean;
  /**
   * `chrome` for labels inside fixed-size map UI, which must not grow enough
   * to cover what they label; `content` for sheet copy, which scales freely.
   */
  scale?: keyof typeof maxFontScale;
}

const toneColor = (tone: Tone): string =>
  tone in color.text
    ? color.text[tone as keyof typeof color.text]
    : color.accent[tone as keyof typeof color.accent];

/** The only Text in the app. Raw <Text> bypasses the type scale and Dynamic Type caps. */
export const HText = ({
  variant = 'body',
  tone = 'primary',
  tabular = false,
  scale = 'content',
  style,
  ...rest
}: HTextProps) => (
  <Text
    allowFontScaling
    maxFontSizeMultiplier={maxFontScale[scale]}
    style={[
      typeScale[variant],
      { color: toneColor(tone) },
      tabular ? { fontVariant: ['tabular-nums'] } : null,
      style,
    ]}
    {...rest}
  />
);
