/**
 * Haven design tokens.
 *
 * "Playful Minimalism" over a dark map: one midnight base, frosted-glass
 * surfaces, and three pastel accents that carry all of the personality.
 *
 * This file is pure data with no React Native imports, so contrast can be
 * verified in plain Node (`test/tokens.test.ts`). Every text/surface pairing
 * below is measured *composited* — glass over the real map colours — because
 * a translucent surface has no contrast ratio of its own. A pairing that
 * passes on the token sheet and fails over a bright road is a failure.
 *
 * Components must use the semantic tokens (`color.*`), never `palette.*`.
 */

// ---------------------------------------------------------------------------
// Raw palette — referenced only by the semantic layer below
// ---------------------------------------------------------------------------

export const palette = {
  midnight950: '#070B1A',
  navy900: '#0C1228',
  navy800: '#131B3A',
  navy700: '#1D2750',
  navy600: '#2B3557',

  /** Dark ink for text and icons placed ON a pastel fill. */
  ink: '#0A0F24',

  // The three brand accents. Pastel, but saturated enough to read as
  // "electric" against midnight — and all three clear 4.5:1 as text on glass.
  electricPeach: '#FFAD8F',
  neonMint: '#7CF5C8',
  softLavender: '#B9A7FF',

  // Status colours, used sparingly and never alone (see BatteryRing).
  amber: '#FFD27A',
  coral: '#FF8A8A',

  white: '#FFFFFF',
  snow: '#F4F6FF',
  mist: '#B8C0E0',
  slate: '#8A93B8',
} as const;

// ---------------------------------------------------------------------------
// Map backdrop — what the glass actually sits on
// ---------------------------------------------------------------------------

/**
 * The extremes of the muted dark map style. Contrast is verified against
 * BOTH: land/water is the common case, the brightest road is the worst case
 * a sheet or label can end up floating over.
 */
export const mapBackdrop = {
  darkest: palette.midnight950,
  brightest: palette.navy600,
} as const;

// ---------------------------------------------------------------------------
// Semantic colour
// ---------------------------------------------------------------------------

export const color = {
  background: palette.midnight950,

  glass: {
    /**
     * Fill laid over the native blur. 0.72 alpha is deliberately heavier than
     * the 0.10–0.30 glass you see on marketing sites: those sit over a
     * controlled gradient, ours sits over an arbitrary map, and the composed
     * result must hold 4.5:1 for secondary text over the brightest road.
     */
    fill: 'rgba(16, 23, 52, 0.72)',
    fillAlpha: 0.72,
    fillRgb: '#101734',
    /** Android without blur support: same hue, opaque enough to stand alone. */
    fallbackFill: 'rgba(16, 23, 52, 0.94)',
    border: 'rgba(255, 255, 255, 0.12)',
    /** 1px top highlight that sells the "light from above" glass edge. */
    highlight: 'rgba(255, 255, 255, 0.08)',
    blurIntensity: 40,
  },

  text: {
    primary: palette.snow,
    /** Normal-size secondary text. Verified >= 4.5:1 composited. */
    secondary: palette.mist,
    /**
     * GLASS-BACKED ONLY. Measures 5.33:1 on glass over the brightest road but
     * 3.97:1 on the bare map, so it may be used at any size inside a glass
     * surface and never as a label drawn straight onto the map.
     */
    tertiary: palette.slate,
    onAccent: palette.ink,
  },

  accent: {
    /** Primary action, selection, the "you" marker. */
    peach: palette.electricPeach,
    /** Positive state: online, charging, precise location. */
    mint: palette.neonMint,
    /** Calm / privacy state: approximate location, Trust Mode. */
    lavender: palette.softLavender,
  },

  status: {
    warning: palette.amber,
    critical: palette.coral,
  },

  map: {
    /** Accuracy ring under a precise avatar. Barely there on purpose. */
    preciseFill: 'rgba(124, 245, 200, 0.10)',
    preciseStroke: 'rgba(124, 245, 200, 0.45)',
    /** The fuzz disc. Must read as "somewhere in here", never as a pin. */
    approximateFill: 'rgba(185, 167, 255, 0.14)',
    approximateStroke: 'rgba(185, 167, 255, 0.55)',
  },

  scrim: 'rgba(7, 11, 26, 0.55)',
} as const;

// ---------------------------------------------------------------------------
// Typography — Inter, on both platforms
// ---------------------------------------------------------------------------

/**
 * Inter rather than SF Pro: SF Pro's licence restricts it to Apple platforms,
 * so using it would make the Android app a different product. Inter's
 * geometric construction carries the same "clean, friendly" read.
 */
export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/**
 * One modular scale (12 14 16 18 24 32), body at 16. Line heights are ~1.4–1.5
 * for text that wraps and tighter for single-line display text.
 */
export const typeScale = {
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.medium },
  footnote: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.regular },
  callout: { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.semibold },
  title: { fontSize: 24, lineHeight: 30, fontFamily: fontFamily.bold },
  display: { fontSize: 32, lineHeight: 38, fontFamily: fontFamily.bold },
} as const;

export type TypeVariant = keyof typeof typeScale;

/**
 * Cap on Dynamic Type growth for labels inside fixed-size chrome (map chips,
 * the weather badge). Body copy in the sheet scales freely; a 12pt map label
 * that grows 3x would cover the avatar it labels.
 */
export const maxFontScale = {
  chrome: 1.4,
  content: 2.0,
} as const;

// ---------------------------------------------------------------------------
// Space, shape, size
// ---------------------------------------------------------------------------

/** 4/8 rhythm. */
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  sheet: 28,
  pill: 999,
} as const;

export const size = {
  /** iOS HIG minimum; Android's 48dp is met by every interactive token below. */
  touchMin: 44,
  avatar: 44,
  ringStroke: 3,
  ringGap: 2,
  /**
   * Full marker footprint: avatar + gap + ring on each side = 54, rounded up
   * to 56 so the touch target clears 48dp on Android without hitSlop.
   */
  marker: 56,
  weatherBadge: 22,
  icon: { sm: 16, md: 20, lg: 24 },
  sheetHandle: { width: 40, height: 5 },
} as const;

// ---------------------------------------------------------------------------
// Motion — raw numbers; src/ui/motion/springs.ts wraps them for Reanimated
// ---------------------------------------------------------------------------

/**
 * Three springs and two durations, used everywhere. Every animation in the
 * app picks from this list, which is what keeps it feeling like one product.
 */
export const motion = {
  spring: {
    /** Press feedback. Settles in ~120ms with no visible overshoot. */
    snappy: { damping: 20, stiffness: 420, mass: 0.6 },
    /** Selection, sheet settle, avatar pop. The "playful" in the brief: one soft overshoot. */
    bouncy: { damping: 14, stiffness: 220, mass: 0.9 },
    /** Data changes: the battery ring filling, a temperature ticking. */
    gentle: { damping: 24, stiffness: 110, mass: 1 },
  },
  duration: {
    enter: 280,
    /** ~64% of enter: exits get out of the way faster than entrances arrive. */
    exit: 180,
  },
  /** Press scale. Inside the 0.95–1.05 band so it reads as feedback, not motion. */
  pressScale: 0.95,
  selectedScale: 1.08,
} as const;
