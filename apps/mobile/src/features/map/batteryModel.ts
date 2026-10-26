import type { BatteryContext } from '@haven/contracts';

import { color } from '../../ui/theme/tokens';

/**
 * Battery Ring maths and semantics, free of React so it can be tested.
 *
 * The ring encodes battery three ways, because colour alone must never carry
 * meaning:
 *   1. ARC LENGTH — the primary signal; readable by anyone, in any light.
 *   2. Colour     — the member's own accent normally; amber/coral only when
 *                   low, so a warning colour always means "look at this".
 *   3. A bolt     — charging is a shape, not a hue.
 * The full sentence lives in the accessibility label.
 */

export const LOW_BATTERY = 20;
export const CRITICAL_BATTERY = 10;

/**
 * Smallest arc we draw for a non-zero battery, as a fraction of the ring.
 * A 2% battery rendered at a true 2% is a sub-pixel sliver that reads as
 * "no ring" — i.e. as missing data rather than as nearly flat.
 */
const MIN_VISIBLE_FRACTION = 0.04;

export interface RingGeometry {
  /** Outer box edge. */
  size: number;
  radius: number;
  circumference: number;
  strokeWidth: number;
}

export const ringGeometry = (size: number, strokeWidth: number): RingGeometry => {
  // Inset by half the stroke so the line sits fully inside the box.
  const radius = (size - strokeWidth) / 2;
  return { size, radius, circumference: 2 * Math.PI * radius, strokeWidth };
};

/** The fraction of the ring to fill, with the visibility floor applied. */
export const fillFraction = (percent: number): number => {
  const clamped = Math.min(100, Math.max(0, percent)) / 100;
  if (clamped === 0) return 0;
  return Math.max(clamped, MIN_VISIBLE_FRACTION);
};

/** strokeDashoffset for a given fill: 0 = full ring, circumference = empty. */
export const dashOffset = (percent: number, circumference: number): number =>
  circumference * (1 - fillFraction(percent));

export type BatteryTone = 'accent' | 'charging' | 'warning' | 'critical';

/**
 * Charging wins over low: a phone at 8% on a charger is not an emergency,
 * and painting it coral would teach people to ignore coral.
 */
export const batteryTone = (battery: BatteryContext): BatteryTone => {
  if (battery.state === 'charging' || battery.state === 'full') return 'charging';
  if (battery.percent <= CRITICAL_BATTERY) return 'critical';
  if (battery.percent <= LOW_BATTERY) return 'warning';
  return 'accent';
};

export const toneColor = (tone: BatteryTone, memberAccent: string): string => {
  switch (tone) {
    case 'charging':
      return color.accent.mint;
    case 'critical':
      return color.status.critical;
    case 'warning':
      return color.status.warning;
    case 'accent':
      return memberAccent;
  }
};

/**
 * The spoken description. Low Power Mode is included because it is exactly
 * the "why aren't they replying?" context the product exists to surface.
 */
export const batteryDescription = (battery: BatteryContext | undefined): string => {
  if (!battery) return 'battery unknown';

  const parts = [`battery ${battery.percent} percent`];
  if (battery.state === 'charging') parts.push('charging');
  if (battery.state === 'full') parts.push('fully charged');
  if (battery.state !== 'charging' && battery.state !== 'full') {
    if (battery.percent <= CRITICAL_BATTERY) parts.push('critically low');
    else if (battery.percent <= LOW_BATTERY) parts.push('low');
  }
  if (battery.powerSaving) parts.push('low power mode on');
  return parts.join(', ');
};
