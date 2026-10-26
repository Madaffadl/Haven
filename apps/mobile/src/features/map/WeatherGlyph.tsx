import type { WeatherContext } from '@haven/contracts';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { color, palette, size } from '../../ui/theme/tokens';
import { weatherKind, type GlyphMotion, type WeatherKind } from './weatherModel';

/**
 * Weather micro-animation for a map avatar.
 *
 * Built from vector icons and Reanimated transforms rather than Lottie:
 *   - up to sixteen of these can be on screen at once, inside MarkerViews,
 *     and a Lottie player per marker is a lot of decoding for a 22pt badge;
 *   - the art is themeable through tokens, where a Lottie file bakes colour in;
 *   - every element moves by transform/opacity only, on the UI thread.
 * Lottie stays the tool for the large, one-off nudge bursts.
 *
 * Each glyph is driven by ONE shared value `t` cycling 0→1, from which every
 * element derives its pose. Every pose is chosen so that t = 0 and t = 1 look
 * identical — so 'once' ends exactly on the resting frame, and 'still' is the
 * same frame with no animation at all.
 */

const CYCLE_MS: Record<WeatherKind, number> = {
  // Rotation is constant-rate, so it is the one place linear easing is right.
  clear: 12_000,
  'partly-cloudy': 5_000,
  cloudy: 6_000,
  fog: 7_000,
  drizzle: 1_600,
  rain: 1_100,
  snow: 3_200,
  storm: 3_000,
};

/** 'once' plays this many cycles as a "just updated" cue, then rests. */
const ONCE_CYCLES = 2;

const ICON_SIZE = 14;
const STROKE = 2;

const iconFor = (kind: WeatherKind, isDay: boolean): LucideIcon => {
  switch (kind) {
    case 'clear':
      return isDay ? Sun : Moon;
    case 'partly-cloudy':
      return isDay ? CloudSun : CloudMoon;
    case 'fog':
      return CloudFog;
    case 'storm':
      return CloudLightning;
    case 'cloudy':
    case 'drizzle':
    case 'rain':
    case 'snow':
      return Cloud;
  }
};

const iconColor = (kind: WeatherKind, isDay: boolean): string => {
  if (kind === 'clear') return isDay ? color.accent.peach : color.accent.lavender;
  return color.text.secondary;
};

const hasPrecipitation = (kind: WeatherKind) =>
  kind === 'drizzle' || kind === 'rain' || kind === 'snow';

interface WeatherGlyphProps {
  weather: WeatherContext;
  motion: GlyphMotion;
  /**
   * Bumped by the parent when the weather genuinely changes. Part of the
   * effect's dependencies, so a 'once' replays on a real change — and does
   * NOT restart every time a battery tick re-renders the marker.
   */
  replayKey: number;
}

export const WeatherGlyph = memo(({ weather, motion, replayKey }: WeatherGlyphProps) => {
  const kind = weatherKind(weather.code);
  const t = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(t);
    t.value = 0;

    if (motion === 'still') return undefined;

    t.value = withRepeat(
      withTiming(1, {
        duration: CYCLE_MS[kind],
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      }),
      motion === 'loop' ? -1 : ONCE_CYCLES,
      false,
    );

    // Unmounting mid-loop must not leave a repeat running on the UI thread.
    return () => cancelAnimation(t);
  }, [kind, motion, replayKey, t]);

  const iconStyle = useAnimatedStyle(() => {
    const phase = t.value * Math.PI * 2;
    switch (kind) {
      case 'clear':
        return weather.isDay
          ? { transform: [{ rotate: `${t.value * 360}deg` }] }
          : // The moon breathes rather than spins; it rests at full opacity
            // and never dips below 0.75, well above the 0.2 floor.
            { opacity: 0.875 + 0.125 * Math.cos(phase) };
      case 'partly-cloudy':
      case 'cloudy':
      case 'fog':
        return { transform: [{ translateX: 1.5 * Math.sin(phase) }] };
      case 'storm':
        // A brief flash early in the cycle; rests lit.
        return { opacity: interpolate(t.value, [0, 0.08, 0.12, 0.16, 1], [1, 0.35, 1, 0.5, 1]) };
      case 'drizzle':
      case 'rain':
      case 'snow':
        // The cloud sits still and higher, so the drops have room to fall.
        return { transform: [{ translateY: -2.5 }, { scale: 0.86 }] };
    }
  });

  const Icon = iconFor(kind, weather.isDay);

  return (
    <View
      style={styles.badge}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={iconStyle}>
        <Icon size={ICON_SIZE} color={iconColor(kind, weather.isDay)} strokeWidth={STROKE} />
      </Animated.View>
      {hasPrecipitation(kind) ? <Precipitation kind={kind} t={t} /> : null}
    </View>
  );
});

WeatherGlyph.displayName = 'WeatherGlyph';

// ---------------------------------------------------------------------------

interface PrecipitationProps {
  kind: WeatherKind;
  t: SharedValue<number>;
}

const DROP_X = [-4, 0, 4] as const;

/** Three drops (or flakes), staggered by a third of a cycle each. */
const Precipitation = ({ kind, t }: PrecipitationProps) => {
  const snow = kind === 'snow';
  const fall = snow ? 5 : 6;

  const drop0 = useDropStyle(t, 0, fall);
  const drop1 = useDropStyle(t, 1 / 3, fall);
  const drop2 = useDropStyle(t, 2 / 3, fall);

  const shape = snow ? styles.flake : kind === 'drizzle' ? styles.drizzle : styles.drop;

  return (
    <>
      {[drop0, drop1, drop2].map((style, index) => (
        <Animated.View
          key={DROP_X[index]}
          style={[shape, { left: size.weatherBadge / 2 + (DROP_X[index] ?? 0) - 1 }, style]}
        />
      ))}
    </>
  );
};

const useDropStyle = (t: PrecipitationProps['t'], offset: number, distance: number) =>
  useAnimatedStyle(() => {
    const phase = (t.value + offset) % 1;
    return {
      // Fade in over the first fifth and out over the last fifth, so a drop
      // never pops into existence or vanishes mid-air.
      opacity: interpolate(phase, [0, 0.2, 0.8, 1], [0, 1, 1, 0]),
      transform: [{ translateY: phase * distance }],
    };
  });

const styles = StyleSheet.create({
  badge: {
    width: size.weatherBadge,
    height: size.weatherBadge,
    borderRadius: size.weatherBadge / 2,
    // Solid, not glass: a BlurView per marker means up to sixteen live blurs
    // over a GL map surface, which is a real frame-time and battery cost for
    // a badge this small. navy800 sits close to the composited glass colour,
    // so it still reads as part of the same material.
    backgroundColor: palette.navy800,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.glass.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  drop: {
    position: 'absolute',
    top: 12,
    width: 1.5,
    height: 4,
    borderRadius: 1,
    backgroundColor: color.accent.lavender,
  },
  drizzle: {
    position: 'absolute',
    top: 12,
    width: 1.5,
    height: 2.5,
    borderRadius: 1,
    backgroundColor: color.accent.lavender,
  },
  flake: {
    position: 'absolute',
    top: 12,
    width: 2.5,
    height: 2.5,
    borderRadius: 1.25,
    backgroundColor: palette.snow,
  },
});
