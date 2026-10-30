import type { MemberPresence, MemberProfile, TrustMode } from '@haven/contracts';
import * as Haptics from 'expo-haptics';
import { Clock } from 'lucide-react-native';
import { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { spring } from '../../ui/motion/springs';
import { color, motion, palette, size } from '../../ui/theme/tokens';
import { BatteryRing } from './BatteryRing';
import { WeatherGlyph } from './WeatherGlyph';
import {
  initialsColor,
  initialsOf,
  isStale,
  markerAccessibilityLabel,
  nameOf,
} from './presenceCopy';
import { MODE_VISUALS } from '../trust-mode/modeVisuals';
import { selfPrivacyPhrase } from '../trust-mode/trustCopy';
import { glyphMotion } from './weatherModel';

const RING_BOX = size.avatar + 2 * (size.ringGap + size.ringStroke);

interface AvatarMarkerProps {
  member: MemberPresence;
  profile: MemberProfile | undefined;
  selected: boolean;
  isSelf: boolean;
  /**
   * The viewer's own Trust Mode, for their own marker only. The server always
   * shows you yourself as precise, so without this badge nothing on your map
   * would tell you that your circle sees less.
   */
  selfTrustMode?: TrustMode;
  /** Wall clock, ticked by the map, so staleness updates while the app is open. */
  now: number;
  onPress: (userId: string) => void;
}

/**
 * Counts genuine changes to a value, ignoring the first render. Used to replay
 * the weather glyph once when the weather actually changes — and only then,
 * not on every battery tick that re-renders the marker.
 */
const useChangeCount = (value: number | undefined): number => {
  const previous = useRef(value);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setCount((c) => c + 1);
    }
  }, [value]);

  return count;
};

/**
 * One person on the map.
 *
 * Composition, outside in: selection lift → Battery Ring → avatar → badges
 * (weather top-right, staleness bottom-left, charging bolt from the ring).
 *
 * Everything the composition shows is also spoken by its accessibility label;
 * the visual parts are hidden from assistive tech so nothing is read twice.
 */
export const AvatarMarker = memo(
  ({ member, profile, selected, isSelf, selfTrustMode, now, onPress }: AvatarMarkerProps) => {
    const reduceMotion = useReducedMotion();
    const weatherChanges = useChangeCount(member.weather?.code);

    const lift = useSharedValue(selected ? 1 : 0);

    useEffect(() => {
      // Bouncy on the way up — this is the playful moment — and snappy on the
      // way down, so deselection gets out of the way faster than selection
      // arrived.
      lift.value = withSpring(selected ? 1 : 0, selected ? spring.bouncy : spring.snappy);
    }, [lift, selected]);

    const liftStyle = useAnimatedStyle(() => ({
      transform: [
        { translateY: interpolate(lift.value, [0, 1], [0, -4]) },
        { scale: interpolate(lift.value, [0, 1], [1, motion.selectedScale]) },
      ],
    }));

    const haloStyle = useAnimatedStyle(() => ({
      opacity: lift.value,
      transform: [{ scale: interpolate(lift.value, [0, 1], [0.85, 1]) }],
    }));

    const name = nameOf(profile);
    const accent = profile?.accentHex ?? color.accent.lavender;
    const stale = isStale(member.capturedAt, now);
    const privacy = isSelf && selfTrustMode && selfTrustMode !== 'precise' ? selfTrustMode : null;
    const PrivacyIcon = privacy ? MODE_VISUALS[privacy].icon : null;

    return (
      <PressableScale
        accessibilityLabel={
          markerAccessibilityLabel(member, profile, now) +
          (privacy ? `. ${selfPrivacyPhrase(privacy)}` : '')
        }
        accessibilityHint="Shows details"
        accessibilityState={{ selected }}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();
          onPress(member.userId);
        }}
        style={styles.touch}
      >
        <Animated.View style={liftStyle}>
          {/* A soft midnight plate under the ring. Place names are drawn in
              the map beneath every marker, and without it the label text ran
              straight through the avatar and its badges. */}
          <View pointerEvents="none" style={styles.backplate} />
          <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />

          <BatteryRing battery={member.battery} accent={accent} size={RING_BOX}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: accent },
                isSelf ? styles.selfOutline : null,
                // Dimmed, never faded out: an offline person is still there,
                // and 0.55 stays well above the 0.2 "lingering" floor.
                !member.online || stale ? styles.dimmed : null,
              ]}
            >
              {profile?.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.image} />
              ) : (
                <HText
                  variant="callout"
                  scale="chrome"
                  style={{ color: initialsColor(accent) }}
                  accessible={false}
                >
                  {initialsOf(name)}
                </HText>
              )}
            </View>
          </BatteryRing>

          {member.weather ? (
            <View style={styles.weather}>
              <WeatherGlyph
                weather={member.weather}
                replayKey={weatherChanges}
                motion={glyphMotion({
                  selected,
                  changedRecently: weatherChanges > 0,
                  reduceMotion,
                })}
              />
            </View>
          ) : null}

          {stale ? (
            // A shape for staleness, not just the dimming: "old data" must be
            // distinguishable from "offline" without relying on opacity alone.
            <View style={styles.stale}>
              <Clock size={10} color={color.text.primary} strokeWidth={2.5} />
            </View>
          ) : null}

          {PrivacyIcon ? (
            <View style={styles.privacy}>
              <PrivacyIcon size={10} color={color.text.onAccent} strokeWidth={2.75} />
            </View>
          ) : null}
        </Animated.View>
      </PressableScale>
    );
  },
);

AvatarMarker.displayName = 'AvatarMarker';

const BADGE = 16;

const styles = StyleSheet.create({
  touch: {
    width: size.marker,
    height: size.marker,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backplate: {
    position: 'absolute',
    left: -5,
    top: -5,
    width: RING_BOX + 10,
    height: RING_BOX + 10,
    borderRadius: (RING_BOX + 10) / 2,
    backgroundColor: color.scrim,
  },
  halo: {
    position: 'absolute',
    left: -4,
    top: -4,
    width: RING_BOX + 8,
    height: RING_BOX + 8,
    borderRadius: (RING_BOX + 8) / 2,
    borderWidth: 2,
    borderColor: color.accent.peach,
  },
  avatar: {
    width: size.avatar,
    height: size.avatar,
    borderRadius: size.avatar / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: size.avatar, height: size.avatar },
  selfOutline: { borderWidth: 2, borderColor: color.accent.peach },
  dimmed: { opacity: 0.55 },
  weather: { position: 'absolute', right: -6, top: -6 },
  stale: {
    position: 'absolute',
    left: -2,
    bottom: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: palette.navy700,
    borderWidth: 1.5,
    borderColor: color.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacy: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: color.accent.lavender,
    borderWidth: 1.5,
    borderColor: color.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
