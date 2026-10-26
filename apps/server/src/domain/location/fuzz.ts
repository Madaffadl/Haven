import { createHash, randomBytes } from 'node:crypto';
import type { Coordinate } from '@haven/contracts';

/**
 * Trust Mode / Approximate — the spatial core.
 *
 * ## Why this is not random jitter
 *
 * The intuitive implementation of "blur my location" adds random noise to
 * every broadcast. It is actively dangerous. Noise added independently per
 * sample is averaged away by an observer who collects N of them: the error
 * of the mean shrinks as `jitter / sqrt(N)`. A 2 km "blur" sampled every
 * 2 minutes for one evening (N ≈ 300) localises a stationary person to
 * roughly 100 m — their building. The feature that was supposed to protect
 * them instead advertises a false sense of safety while leaking their home.
 *
 * Haven snaps to a grid instead. A stationary member maps to one cell, and
 * therefore to one broadcast coordinate, forever. Collecting a million
 * samples teaches the observer exactly what the first one did. The function
 * is deterministic, which is precisely what makes it safe — there is no
 * noise to average because there is no noise.
 *
 * Three properties carry the design:
 *
 * 1. **Salted grid phase.** An unsalted lattice is public knowledge: given a
 *    centroid, an attacker knows the true position lies in a specific square
 *    whose corners they can compute. `phaseSalt` offsets the grid origin per
 *    (user, circle), so the cell boundaries are unknown to everyone except
 *    the server.
 *
 * 2. **Hysteresis.** Snapping alone makes a member standing on a cell
 *    boundary flicker between two centroids as GPS noise pushes them back and
 *    forth. That looks broken *and* it reveals the boundary's position, which
 *    undoes property 1. `resolveAnchor` keeps the previous cell until the
 *    member is genuinely far from it — which is why anchors are persisted in
 *    `location_fuzz_anchors` rather than recomputed from scratch.
 *
 * 3. **Latitude correction.** EPSG:3857 metres compress by cos(latitude).
 *    Without the correction a nominal 1 km cell is ~500 m in Helsinki and
 *    ~250 m in Tromsø — the privacy guarantee silently weakens the further
 *    north you live.
 *
 * This module is pure: no database, no clock, no sockets. That is what makes
 * the adversarial test in `test/fuzz.test.ts` — run 10,000 samples and assert
 * the mean does *not* converge — possible to write at all.
 */

/** Spherical Mercator radius (EPSG:3857). Matches PostGIS ST_Transform. */
const MERCATOR_RADIUS_M = 6_378_137;

/** EPSG:3857 is undefined beyond this latitude. */
const MERCATOR_MAX_LAT = 85.051_128_78;

/**
 * Floor on the cos() correction. Past ~87° the correction diverges and would
 * produce absurd cell sizes; clamping caps the cell at 20x nominal instead.
 */
const MIN_COS_LAT = 0.05;

/** Below this, a "fuzzy" cell is smaller than ordinary GPS error anyway. */
const MIN_RADIUS_M = 100;

/**
 * How far outside the cached cell a member must be before the anchor moves,
 * as a fraction of cell size. 0.75 keeps the dot still through normal GPS
 * wander and short walks while still tracking a real departure.
 */
export const HYSTERESIS_FACTOR = 0.75;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

interface MercatorPoint {
  readonly x: number;
  readonly y: number;
}

export interface Cell {
  /** `<radius>:<latBand>:<gridX>:<gridY>`. Identical to SQL `haven_cell_key()`. */
  readonly key: string;
  /** The only coordinate that ever leaves the server for this member. */
  readonly centroid: Coordinate;
  /** Edge length in projected metres, for hysteresis comparisons. */
  readonly sizeM: number;
}

const toMercator = ([lon, lat]: Coordinate): MercatorPoint => {
  const clampedLat = Math.min(MERCATOR_MAX_LAT, Math.max(-MERCATOR_MAX_LAT, lat));
  return {
    x: lon * DEG_TO_RAD * MERCATOR_RADIUS_M,
    y: MERCATOR_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * DEG_TO_RAD) / 2)),
  };
};

const fromMercator = ({ x, y }: MercatorPoint): Coordinate => [
  (x / MERCATOR_RADIUS_M) * RAD_TO_DEG,
  (2 * Math.atan(Math.exp(y / MERCATOR_RADIUS_M)) - Math.PI / 2) * RAD_TO_DEG,
];

/**
 * Latitude band used for the cos() correction, in whole degrees.
 *
 * The correction MUST be quantised. Deriving cell size from the exact
 * latitude makes the grid itself a continuous function of position: every
 * metre of GPS wobble resizes the cell very slightly, which shifts the
 * lattice, which moves the centroid. The result looks stable but is not —
 * a stationary member emits a different coordinate on every single report,
 * and the averaging attack this module exists to defeat works perfectly
 * against it. (This was a real bug here; `test/fuzz.test.ts` caught it by
 * asserting a stationary member produces exactly one distinct output.)
 *
 * One-degree bands are ~111 km tall, so crossing one is a genuine relocation,
 * and the anchor hysteresis absorbs the discontinuity at the boundary.
 */
export const latitudeBand = (latitude: number): number => Math.floor(latitude);

/**
 * Projected cell size. Widened by 1/cos(lat) so that the *ground* size stays
 * near `2 * radiusM` regardless of latitude. Constant within a latitude band,
 * which is what makes the whole grid stable.
 */
export const cellSizeM = (radiusM: number, latitude: number): number => {
  const bandCentre = latitudeBand(latitude) + 0.5;
  return (
    (Math.max(radiusM, MIN_RADIUS_M) * 2) / Math.max(Math.cos(bandCentre * DEG_TO_RAD), MIN_COS_LAT)
  );
};

/**
 * Deterministic grid-origin offset in [0, cell). Uses md5 for one reason:
 * it must produce the same number in PostgreSQL and in Node forever. This is
 * not a security hash — the secret is `phaseSalt`, not the digest — so md5's
 * collision weakness is irrelevant here.
 */
const phaseOffset = (phaseKey: string, axis: 'x' | 'y', cell: number): number => {
  const digest = createHash('md5').update(`${phaseKey}:${axis}`).digest('hex').slice(0, 6);
  return (Number.parseInt(digest, 16) / 0x100_00_00) * cell;
};

/**
 * Snap a precise coordinate into its salted grid cell.
 *
 * Pure and total: the same (coordinate, radius, key) always yields the same
 * cell, which is the entire privacy property.
 */
export const resolveCell = (precise: Coordinate, radiusM: number, phaseKey: string): Cell => {
  const [, latitude] = precise;
  const band = latitudeBand(latitude);
  const cell = cellSizeM(radiusM, latitude);
  const { x, y } = toMercator(precise);

  const phaseX = phaseOffset(phaseKey, 'x', cell);
  const phaseY = phaseOffset(phaseKey, 'y', cell);

  const gridX = Math.floor((x + phaseX) / cell);
  const gridY = Math.floor((y + phaseY) / cell);

  return {
    key: `${Math.round(radiusM)}:${band}:${gridX}:${gridY}`,
    centroid: fromMercator({
      x: (gridX + 0.5) * cell - phaseX,
      y: (gridY + 0.5) * cell - phaseY,
    }),
    sizeM: cell,
  };
};

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** The persisted form, mirroring `location_fuzz_anchors`. */
export interface FuzzAnchor {
  readonly cellKey: string;
  readonly centroid: Coordinate;
  readonly radiusM: number;
  readonly phaseSalt: string;
}

export interface AnchorResolution {
  readonly anchor: FuzzAnchor;
  /** True when the caller must persist and re-broadcast. */
  readonly changed: boolean;
}

/**
 * 128 bits. The salt's only job is to make the grid lattice unguessable; it
 * is generated once per (user, circle) and rotated rarely — rotating it often
 * would re-create the per-sample randomness this whole module exists to
 * avoid.
 */
export const newPhaseSalt = (): string => randomBytes(16).toString('base64url');

const distanceM = (a: Coordinate, b: Coordinate): number => {
  const pa = toMercator(a);
  const pb = toMercator(b);
  // Compare in projected space, consistent with the grid itself.
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
};

/**
 * Decide what this member's broadcast position should be, given where they
 * actually are and what we last published to this circle.
 *
 * The anchor is retained unless the member has left it by more than
 * `HYSTERESIS_FACTOR` cells. Note the test is against the *previous centroid*,
 * not against cell membership: testing cell membership alone is what produces
 * the boundary flicker described at the top of this file.
 */
export const resolveAnchor = (args: {
  precise: Coordinate;
  radiusM: number;
  phaseKey: string;
  previous: FuzzAnchor | null;
}): AnchorResolution => {
  const { precise, radiusM, phaseKey, previous } = args;

  // A radius change is a deliberate privacy decision by the user, so the
  // anchor must be rebuilt rather than carried over at the wrong scale.
  if (previous && previous.radiusM === radiusM) {
    const cell = cellSizeM(radiusM, precise[1]);
    if (distanceM(precise, previous.centroid) <= cell * HYSTERESIS_FACTOR) {
      return { anchor: previous, changed: false };
    }
  }

  const salt = previous?.radiusM === radiusM ? previous.phaseSalt : newPhaseSalt();
  const cell = resolveCell(precise, radiusM, `${phaseKey}:${salt}`);

  // Re-snapping can land on the cell we already published (the member wandered
  // out and back). Report unchanged so we don't emit a no-op update.
  if (previous && previous.cellKey === cell.key && previous.radiusM === radiusM) {
    return { anchor: previous, changed: false };
  }

  return {
    anchor: { cellKey: cell.key, centroid: cell.centroid, radiusM, phaseSalt: salt },
    changed: true,
  };
};
