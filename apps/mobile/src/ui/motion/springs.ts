import {
  ReduceMotion,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { motion } from '../theme/tokens';

/**
 * The only spring configs in the app.
 *
 * Every config carries `reduceMotion: ReduceMotion.System`, so when the user
 * has Reduce Motion on, Reanimated jumps straight to the final value instead
 * of animating to it. Putting that here — rather than at each call site — is
 * what makes the preference impossible to forget: there is no way to get a
 * spring in this codebase that ignores it.
 *
 * These APIs are identical in Reanimated 3 and 4.
 */

const withSystemMotion = <T extends object>(config: T): T & { reduceMotion: ReduceMotion } => ({
  ...config,
  reduceMotion: ReduceMotion.System,
});

export const spring = {
  snappy: withSystemMotion(motion.spring.snappy) satisfies WithSpringConfig,
  bouncy: withSystemMotion(motion.spring.bouncy) satisfies WithSpringConfig,
  gentle: withSystemMotion(motion.spring.gentle) satisfies WithSpringConfig,
} as const;

export const timing = {
  enter: withSystemMotion({ duration: motion.duration.enter }) satisfies WithTimingConfig,
  exit: withSystemMotion({ duration: motion.duration.exit }) satisfies WithTimingConfig,
} as const;
