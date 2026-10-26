import type { BatteryContext } from '@haven/contracts';
import { Zap } from 'lucide-react-native';
import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { spring } from '../../ui/motion/springs';
import { color, size as sizes } from '../../ui/theme/tokens';
import { batteryTone, dashOffset, ringGeometry, toneColor } from './batteryModel';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface BatteryRingProps {
  battery: BatteryContext | undefined;
  /** The member's own accent; used for the arc unless battery is low. */
  accent: string;
  /** Outer box edge in points. */
  size: number;
  children: ReactNode;
}

/**
 * A battery gauge drawn as a ring around the avatar.
 *
 * Arc length is the signal; colour reinforces it; a bolt marks charging.
 * Nothing here depends on colour alone (see batteryModel.ts).
 *
 * The arc animates `strokeDashoffset` on the UI thread with the `gentle`
 * spring, which is overdamped (ζ ≈ 1.14) on purpose — a battery gauge that
 * overshoots to 68% on its way to 65% is lying for a quarter of a second.
 *
 * Decorative to assistive tech: AvatarMarker speaks the full sentence, so the
 * ring is hidden rather than announced twice.
 */
export const BatteryRing = memo(({ battery, accent, size, children }: BatteryRingProps) => {
  const geometry = useMemo(() => ringGeometry(size, sizes.ringStroke), [size]);
  const percent = battery?.percent ?? 0;

  const offset = useSharedValue(dashOffset(percent, geometry.circumference));

  useEffect(() => {
    offset.value = withSpring(dashOffset(percent, geometry.circumference), spring.gentle);
  }, [offset, percent, geometry.circumference]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  const tone = battery ? batteryTone(battery) : null;
  const arcColor = tone ? toneColor(tone, accent) : color.text.tertiary;
  const center = size / 2;

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Rotated -90° so the arc starts at 12 o'clock, like every battery icon. */}
      <Svg width={size} height={size} style={styles.rotated}>
        <Circle
          cx={center}
          cy={center}
          r={geometry.radius}
          stroke={accent}
          strokeOpacity={0.22}
          strokeWidth={geometry.strokeWidth}
          fill="none"
        />
        {battery ? (
          <AnimatedCircle
            cx={center}
            cy={center}
            r={geometry.radius}
            stroke={arcColor}
            strokeWidth={geometry.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={geometry.circumference}
            animatedProps={animatedProps}
            fill="none"
          />
        ) : null}
      </Svg>

      <View style={styles.content}>{children}</View>

      {tone === 'charging' ? (
        <View style={styles.bolt}>
          <Zap size={10} color={color.text.onAccent} strokeWidth={2.5} fill={color.text.onAccent} />
        </View>
      ) : null}
    </View>
  );
});

BatteryRing.displayName = 'BatteryRing';

const BOLT = 16;

const styles = StyleSheet.create({
  rotated: { transform: [{ rotate: '-90deg' }] },
  content: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bolt: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BOLT,
    height: BOLT,
    borderRadius: BOLT / 2,
    backgroundColor: color.accent.mint,
    alignItems: 'center',
    justifyContent: 'center',
    // Separates the badge from the ring it overlaps, in both themes.
    borderWidth: 1.5,
    borderColor: color.background,
  },
});
