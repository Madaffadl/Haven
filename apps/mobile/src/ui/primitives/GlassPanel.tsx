import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { color, radius } from '../theme/tokens';

interface GlassPanelProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius token; the sheet uses `sheet`, chips use `pill`. */
  rounded?: keyof typeof radius;
}

/**
 * Frosted glass over the map.
 *
 * iOS: native blur + tinted fill + hairline border + a 1px top highlight.
 *
 * Android: an opaque-enough fill and no blur, on purpose. Mapbox renders into
 * a SurfaceView on Android, which view-based blur cannot sample — a BlurView
 * there renders as a flat or flickering rectangle, and on lower-end devices
 * a full-screen blur over a live GL surface is also a measurable battery and
 * frame-time cost. The fallback fill is verified for contrast in
 * test/tokens.test.ts, so legibility is identical; only the frost differs.
 */
export const GlassPanel = ({ children, style, rounded = 'lg' }: GlassPanelProps) => {
  const borderRadius = radius[rounded];

  return (
    <View style={[styles.frame, { borderRadius }, style]}>
      {Platform.OS === 'ios' ? (
        <>
          <BlurView
            intensity={color.glass.blurIntensity}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: color.glass.fill }]} />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color.glass.fallbackFill }]} />
      )}
      <View pointerEvents="none" style={[styles.highlight, { borderRadius }]} />
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.glass.border,
  },
  highlight: {
    position: 'absolute',
    inset: 0,
    borderTopWidth: 1,
    borderColor: color.glass.highlight,
  },
});
