import type { MemberProfile, NudgeKind } from '@haven/contracts';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { acknowledgeNudge } from '../../core/realtime/socket';
import { nudgeActions, useNudges } from '../../state/nudges';
import { usePresence } from '../../state/presence';
import type { NudgeMoment } from '../../state/nudgeReducer';
import { spring, timing } from '../../ui/motion/springs';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { space } from '../../ui/theme/tokens';
import { nameOf } from '../map/presenceCopy';
import { playNudgeHaptic } from './haptics';
import { nudgeEmoji, receivedCopy, seenCopy } from './nudgeCopy';

/** How long each moment holds the screen before the next one plays. */
const BURST_MS = 1_700;
const NOTICE_MS = 2_200;

const PARTICLES = 10;
const SPREAD_MS = 900;

/**
 * Plays nudge moments over the map, one at a time.
 *
 * Never intercepts a touch (pointerEvents none): a heart arriving mid-pan
 * must not swallow the pan. Moments wait while the app is in the
 * background, because "seen" (the ack sent below) has to mean a person had
 * the screen in front of them, not that a socket happened to be open.
 */
export const NudgeOverlay = () => {
  const moment = useNudges((s) => s.queue[0]);
  const profiles = usePresence((s) => (moment ? s.circles[moment.circleId]?.profiles : undefined));
  const active = useAppActive();
  const insets = useSafeAreaInsets();

  const caption = moment ? captionFor(moment, profiles) : null;
  const momentId = moment?.id;

  // Runs once per moment, keyed by its id: a re-render mid-burst (a battery
  // tick updating presence, say) must not restart it or ack it twice.
  useEffect(() => {
    const current = useNudges.getState().queue[0];
    if (!current || current.id !== momentId || !active) return undefined;

    if (current.type === 'received') {
      acknowledgeNudge(current.nudgeId);
      void playNudgeHaptic(current.kind);
    }
    const spoken = captionFor(current, usePresence.getState().circles[current.circleId]?.profiles);
    if (spoken) AccessibilityInfo.announceForAccessibility(spoken);

    const timer = setTimeout(
      () => nudgeActions().shown(),
      current.type === 'seen' ? NOTICE_MS : BURST_MS,
    );
    return () => clearTimeout(timer);
  }, [momentId, active]);

  if (!moment || !active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} key={moment.id}>
      {moment.type !== 'seen' ? <Burst kind={moment.kind} /> : null}
      {caption ? (
        <Caption
          text={caption}
          emoji={nudgeEmoji(moment.kind)}
          top={insets.top + space.xxl + space.sm}
        />
      ) : null}
    </View>
  );
};

const captionFor = (
  moment: NudgeMoment,
  profiles: Record<string, MemberProfile> | undefined,
): string | null => {
  switch (moment.type) {
    case 'received':
      return receivedCopy(moment.kind, nameOf(profiles?.[moment.fromUserId]));
    case 'seen':
      return seenCopy(moment.kind, nameOf(profiles?.[moment.byUserId]));
    default:
      // Your own burst needs no words: you just tapped it.
      return null;
  }
};

const useAppActive = (): boolean => {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return active;
};

// ---------------------------------------------------------------------------

/**
 * The emoji pops in the middle with the bouncy spring, and copies of it fan
 * out and drift up as they fade. With Reduce Motion on there is no fan-out,
 * only the emoji appearing and leaving, so the nudge still lands without
 * movement across the screen.
 */
const Burst = ({ kind }: { kind: NudgeKind }) => {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(0);
  const spread = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    pop.value = withSpring(1, spring.bouncy);
    spread.value = withTiming(1, {
      duration: SPREAD_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
    fade.value = withDelay(BURST_MS - 500, withTiming(0, timing.exit));
  }, [pop, spread, fade]);

  const centre = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ scale: interpolate(pop.value, [0, 1], [0.3, 1]) }],
  }));

  // Fixed per burst: re-rolling on re-render would make particles jump.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        angle: (i / PARTICLES) * 2 * Math.PI + (Math.random() - 0.5) * 0.5,
        distance: 90 + Math.random() * 70,
        size: 22 + Math.random() * 12,
      })),
    [],
  );

  const emoji = nudgeEmoji(kind);

  return (
    <View style={styles.centre}>
      {reduceMotion
        ? null
        : particles.map((p, i) => <Particle key={i} {...p} emoji={emoji} spread={spread} />)}
      <Animated.View style={centre}>
        <HText style={styles.bigEmoji} scale="chrome" accessible={false}>
          {emoji}
        </HText>
      </Animated.View>
    </View>
  );
};

const Particle = ({
  angle,
  distance,
  size,
  emoji,
  spread,
}: {
  angle: number;
  distance: number;
  size: number;
  emoji: string;
  spread: SharedValue<number>;
}) => {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(spread.value, [0, 0.15, 0.65, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: Math.cos(angle) * distance * spread.value },
      // Drift upward as well as outward, like something released.
      { translateY: Math.sin(angle) * distance * spread.value - 40 * spread.value },
      { scale: interpolate(spread.value, [0, 0.3, 1], [0.4, 1, 0.8]) },
    ],
  }));

  return (
    <Animated.View style={[styles.particle, style]}>
      <HText style={{ fontSize: size, lineHeight: size * 1.25 }} scale="chrome" accessible={false}>
        {emoji}
      </HText>
    </Animated.View>
  );
};

const Caption = ({ text, emoji, top }: { text: string; emoji: string; top: number }) => {
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withSpring(1, spring.snappy);
  }, [shown]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: interpolate(shown.value, [0, 1], [-8, 0]) }],
  }));

  return (
    <Animated.View style={[styles.caption, { top }, style]}>
      <GlassPanel rounded="pill" style={styles.captionPanel}>
        <HText variant="body" numberOfLines={2} style={styles.captionText}>
          {`${emoji}  ${text}`}
        </HText>
      </GlassPanel>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  centre: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the geometric centre: the sheet covers the bottom of the map.
    paddingBottom: 160,
  },
  particle: { position: 'absolute' },
  bigEmoji: { fontSize: 88, lineHeight: 104 },
  caption: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  captionPanel: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  captionText: { textAlign: 'center' },
});
