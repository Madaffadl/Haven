import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { spring } from '../motion/springs';
import { motion, size } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Every caller must say what this does; an unlabeled control is a bug. */
  accessibilityLabel: string;
}

/**
 * Pressable with spring press feedback.
 *
 * - Scales to 0.95 on press-in with the `snappy` spring, so feedback lands
 *   inside the 80–150ms window instead of waiting for release.
 * - Scale is a transform, so it never moves surrounding layout.
 * - Enforces the 44pt minimum touch target; callers can only make it bigger.
 * - Interruptible by construction: a new press-in simply retargets the spring
 *   from wherever it is.
 */
export const PressableScale = ({
  children,
  style,
  onPressIn,
  onPressOut,
  disabled,
  accessibilityState,
  ...rest
}: PressableScaleProps) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      // Merged, not replaced: a caller passing { selected } must not silently
      // drop the disabled state this component is responsible for.
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPressIn={(event) => {
        scale.value = withSpring(motion.pressScale, spring.snappy);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, spring.snappy);
        onPressOut?.(event);
      }}
      style={[
        { minWidth: size.touchMin, minHeight: size.touchMin, opacity: disabled ? 0.4 : 1 },
        style,
        animatedStyle,
      ]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
};
