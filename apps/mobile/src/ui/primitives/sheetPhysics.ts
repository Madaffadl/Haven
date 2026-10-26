/**
 * Bottom-sheet physics, as pure worklet-safe functions.
 *
 * The 'worklet' directives let Reanimated run these on the UI thread during a
 * drag; in Node they are inert string statements, so the same code is unit-
 * tested in test/sheet.test.ts without a device.
 *
 * Coordinates: `y` is the sheet's translateY. 0 = fully expanded; larger
 * values push it down. Snap points are given as visible heights and
 * converted to `y` by the component.
 */

/**
 * iOS's rubber-band curve. Dragging past a bound moves the sheet a
 * diminishing fraction of the finger's travel, so the edge is felt rather
 * than hit. The constant 0.55 is UIScrollView's.
 */
export const rubberBand = (overshoot: number, dimension: number, coefficient = 0.55): number => {
  'worklet';
  if (overshoot === 0 || dimension <= 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const distance = Math.abs(overshoot);
  return sign * (1 - 1 / ((distance * coefficient) / dimension + 1)) * dimension;
};

/** Apply the rubber band outside [minY, maxY]; pass through inside it. */
export const resistedPosition = (
  y: number,
  minY: number,
  maxY: number,
  dimension: number,
): number => {
  'worklet';
  if (y < minY) return minY + rubberBand(y - minY, dimension);
  if (y > maxY) return maxY + rubberBand(y - maxY, dimension);
  return y;
};

/**
 * Where a flick would come to rest under UIKit's normal deceleration.
 *
 * Choosing the snap point from the *projected* end rather than the release
 * position is what makes a flick feel intentional: a short, fast upward
 * swipe expands the sheet even though the finger only moved 30pt.
 * `velocity` is in points per second.
 */
export const projectedEnd = (y: number, velocity: number, decelerationRate = 0.998): number => {
  'worklet';
  return y + ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
};

/** Index of the snap position (in `y`) nearest to `target`. */
export const nearestSnapIndex = (target: number, snapYs: readonly number[]): number => {
  'worklet';
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < snapYs.length; i += 1) {
    const distance = Math.abs((snapYs[i] ?? 0) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
};

/**
 * Snap heights (visible height from the bottom, ascending) → translateY
 * values for a sheet whose rendered height equals the tallest snap.
 */
export const snapHeightsToY = (heights: readonly number[]): number[] => {
  const tallest = Math.max(...heights);
  return heights.map((h) => tallest - h);
};
