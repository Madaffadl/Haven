import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spring } from '../motion/springs';
import { toJS } from '../motion/thread';
import { color, size, space } from '../theme/tokens';
import { GlassPanel } from './GlassPanel';
import { PressableScale } from './PressableScale';
import { nearestSnapIndex, projectedEnd, resistedPosition, snapHeightsToY } from './sheetPhysics';

interface BottomSheetProps {
  /** Visible heights from the bottom edge, ascending. Safe area is added on top. */
  snapHeights: readonly number[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Spoken name for each snap, e.g. ["Collapsed", "Half", "Expanded"]. */
  snapLabels: readonly string[];
  accessibilityLabel: string;
  /**
   * The drag region: handle plus this header. Kept separate from `children`
   * so content below can scroll freely — one primary gesture per region, so
   * a list never fights the sheet for the same vertical swipe.
   */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * A glass bottom sheet with playful, physical motion.
 *
 * How it meets the interaction rules, since each one shaped the code:
 *
 * - Transform only. The sheet is rendered at its tallest height and moved
 *   with translateY; height never animates, so nothing reflows mid-drag.
 * - Tracks the finger 1:1 on the UI thread, with iOS rubber-banding past the
 *   ends — the edge is felt, never hit.
 * - Interruptible. Touch-down cancels any running spring, so you can catch
 *   the sheet in mid-flight. The trap: a plain tap never activates the pan,
 *   so onDeactivate never fires and the sheet would stay frozen wherever the
 *   tap caught it. onFinalize re-settles it in that case.
 * - Intent, not position. Release picks the snap nearest to where the flick
 *   would *coast to*, so a short fast swipe still opens the sheet.
 * - Velocity handoff. The settling spring starts at the finger's release
 *   velocity, so there is no hitch between drag and animation.
 * - Up is bouncy, down is snappy: entrances get the playful overshoot, exits
 *   get out of the way faster than they arrived.
 * - One gesture per region. Only the handle + header drag the sheet; the
 *   content below is free to scroll, so a long member list never fights the
 *   sheet for the same vertical swipe.
 * - An 8pt drag threshold, and horizontal swipes fail the pan, so it never
 *   steals a horizontal swipe or a light tap.
 * - Not drag-only. The handle is a real button that cycles the snaps, the
 *   sheet is `adjustable` for VoiceOver/TalkBack (swipe up/down to resize),
 *   and Android's back button collapses it a level.
 * - Reduce Motion: every spring carries ReduceMotion.System (motion/springs),
 *   so snaps become instant while drag tracking — direct manipulation, not
 *   animation — still works.
 */
export const BottomSheet = ({
  snapHeights,
  index,
  onIndexChange,
  snapLabels,
  accessibilityLabel,
  header,
  children,
}: BottomSheetProps) => {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const heights = useMemo(
    () => snapHeights.map((h) => Math.min(h + insets.bottom, screenHeight - insets.top - space.md)),
    [snapHeights, insets.bottom, insets.top, screenHeight],
  );
  const snapYs = useMemo(() => snapHeightsToY(heights), [heights]);
  const tallest = Math.max(...heights);
  const lowestY = snapYs[0] ?? 0;
  const lastIndex = snapYs.length - 1;

  const y = useSharedValue(snapYs[index] ?? lowestY);
  const startY = useSharedValue(0);
  const dragged = useSharedValue(false);

  /**
   * Index the sheet last settled at by its own gesture. Lets the effect below
   * tell "parent changed index" (animate) from "we just reported the index
   * we already animated to" (do nothing — restarting the spring would kill
   * the release velocity and cause a visible hitch).
   */
  const settledByGesture = useRef<number | null>(null);

  const settle = (next: number) => {
    // Only mark it when the index really changes. Settling back on the same
    // snap triggers no re-render, so a mark left here would never be cleared
    // and would later swallow a legitimate parent-driven move to this index.
    if (next === index) return;
    settledByGesture.current = next;
    onIndexChange(next);
  };

  useEffect(() => {
    const fromGesture = settledByGesture.current === index;
    settledByGesture.current = null;
    if (fromGesture) return;

    const target = snapYs[index] ?? lowestY;
    y.value = withSpring(target, target < y.value ? spring.bouncy : spring.snappy);
  }, [index, snapYs, lowestY, y]);

  // Android back collapses one level before it leaves the screen.
  useEffect(() => {
    if (index === 0) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onIndexChange(index - 1);
      return true;
    });
    return () => subscription.remove();
  }, [index, onIndexChange]);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-24, 24],
    onBegin: () => {
      'worklet';
      cancelAnimation(y);
      startY.value = y.value;
      dragged.value = false;
    },
    onActivate: () => {
      'worklet';
      dragged.value = true;
    },
    onUpdate: (event) => {
      'worklet';
      y.value = resistedPosition(startY.value + event.translationY, 0, lowestY, tallest);
    },
    onDeactivate: (event) => {
      'worklet';
      const next = nearestSnapIndex(projectedEnd(y.value, event.velocityY), snapYs);
      const target = snapYs[next] ?? lowestY;
      const config = target < y.value ? spring.bouncy : spring.snappy;
      y.value = withSpring(target, { ...config, velocity: event.velocityY });
      toJS(settle, next);
    },
    onFinalize: () => {
      'worklet';
      // A tap that never became a drag: put the sheet back where it was going.
      if (!dragged.value) {
        const next = nearestSnapIndex(y.value, snapYs);
        y.value = withSpring(snapYs[next] ?? lowestY, spring.snappy);
      }
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  // The map dims only between half and full, where the sheet becomes the
  // focus. At peek and half the map stays fully legible and interactive.
  // With fewer than three snaps there is no "half", and a zero-width
  // interpolation range would produce NaN — so no scrim at all.
  const halfY = lastIndex >= 2 ? (snapYs[1] ?? 0) : 0;
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: halfY > 0 ? interpolate(y.value, [0, halfY], [1, 0], 'clamp') : 0,
  }));

  const step = (delta: 1 | -1) => {
    const next = Math.min(lastIndex, Math.max(0, index + delta));
    if (next !== index) onIndexChange(next);
  };

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />

      <Animated.View style={[styles.sheet, { height: tallest }, sheetStyle]}>
        <GlassPanel rounded="sheet" style={styles.glass}>
          <GestureDetector gesture={pan}>
            <View>
              <PressableScale
                accessibilityLabel={accessibilityLabel}
                accessibilityRole="adjustable"
                accessibilityHint="Swipe up or down to resize"
                accessibilityValue={{ text: snapLabels[index] ?? '' }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) => {
                  step(event.nativeEvent.actionName === 'increment' ? 1 : -1);
                }}
                // Tap cycles upward and wraps: the drag alternative for anyone
                // who cannot, or would rather not, drag.
                onPress={() => onIndexChange(index >= lastIndex ? 0 : index + 1)}
                style={styles.handleTouch}
              >
                <View style={styles.handle} />
              </PressableScale>
              {header ? <View style={styles.header}>{header}</View> : null}
            </View>
          </GestureDetector>

          <View style={[styles.content, { paddingBottom: insets.bottom + space.md }]}>
            {children}
          </View>
        </GlassPanel>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    inset: 0,
    backgroundColor: color.scrim,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  glass: {
    flex: 1,
    // Only the top corners round; the bottom runs off-screen.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  handleTouch: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    height: size.touchMin,
  },
  handle: {
    width: size.sheetHandle.width,
    height: size.sheetHandle.height,
    borderRadius: size.sheetHandle.height / 2,
    backgroundColor: color.text.tertiary,
  },
  header: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
});
