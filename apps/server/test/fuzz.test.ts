import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HYSTERESIS_FACTOR,
  cellSizeM,
  resolveAnchor,
  resolveCell,
  type FuzzAnchor,
} from '../src/domain/location/fuzz.js';

type LonLat = [number, number];

/** Ground distance, independent of the Mercator maths under test. */
const haversineM = ([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number => {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

/** Seeded RNG so the adversarial test is reproducible. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const JAKARTA: LonLat = [106.8272, -6.1751];
const RADIUS = 1000;
const SALT = 'u:3f1a:c:9b2e:hFq8xK2mNp4Rt7Zc';

describe('resolveCell', () => {
  it('is deterministic', () => {
    const a = resolveCell(JAKARTA, RADIUS, SALT);
    const b = resolveCell(JAKARTA, RADIUS, SALT);
    assert.equal(a.key, b.key);
    assert.deepEqual(a.centroid, b.centroid);
  });

  it('emits the cell_key format SQL haven_cell() produces', () => {
    const { key } = resolveCell(JAKARTA, RADIUS, SALT);
    assert.match(key, /^1000:-?\d+:-?\d+:-?\d+$/);
  });

  it('places the centroid within half a cell diagonal of the true point', () => {
    const cell = cellSizeM(RADIUS, JAKARTA[1]);
    const maxOffset = (cell * Math.SQRT2) / 2;
    const { centroid } = resolveCell(JAKARTA, RADIUS, SALT);
    assert.ok(
      haversineM(JAKARTA, centroid) <= maxOffset * 1.02,
      'centroid must lie inside the cell containing the true point',
    );
  });

  it('corrects for latitude so ground cell size stays near 2 * radius', () => {
    // Without the cos(lat) correction a 1 km cell in Tromsø (69.6°N) would be
    // ~350 m on the ground — the privacy guarantee silently weakening the
    // further north a user lives.
    for (const lat of [0, 35, 55, 69.6]) {
      const cell = cellSizeM(RADIUS, lat);
      const groundSize = cell * Math.cos((lat * Math.PI) / 180);
      // Within 2%: the correction is quantised into 1-degree bands (see
      // latitudeBand), so it tracks the band centre, not the exact latitude.
      // With no correction at all, 69.6° would come out at ~700 m.
      assert.ok(
        Math.abs(groundSize - 2 * RADIUS) / (2 * RADIUS) < 0.02,
        `ground cell size at ${lat}° was ${groundSize.toFixed(0)}m, expected ~2000m`,
      );
    }
  });

  it('puts different salts on different lattices', () => {
    // If the salt did nothing, the grid would be public knowledge and a
    // centroid would bound the true position to a computable square.
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => resolveCell(JAKARTA, RADIUS, `salt-${i}`)).map((c) =>
        c.centroid.join(','),
      ),
    );
    assert.ok(keys.size > 40, `expected salts to scatter centroids, got ${keys.size} distinct`);
  });
});

describe('the averaging attack', () => {
  /**
   * The attack that kills naive location fuzzing.
   *
   * An observer records every broadcast position of a member who is at home
   * all evening and averages them. If the fuzz is independent random noise,
   * the mean converges on the true position as 1/sqrt(N) and the "2 km blur"
   * resolves to a building. If the fuzz is a stable cell, the mean is the
   * centroid no matter how many samples are taken.
   *
   * This test asserts the difference directly, because "our fuzzing is
   * private" is otherwise an untested claim.
   */
  const SAMPLES = 10_000;
  const GPS_NOISE_DEG = 0.0003; // ~33 m, realistic phone jitter while indoors

  const meanOf = (points: LonLat[]): LonLat => [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];

  /** Where the member really is on sample i — sitting still, GPS wandering. */
  const trueFixes = (() => {
    const rand = mulberry32(1337);
    return Array.from({ length: SAMPLES }, (): LonLat => [
      JAKARTA[0] + (rand() - 0.5) * 2 * GPS_NOISE_DEG,
      JAKARTA[1] + (rand() - 0.5) * 2 * GPS_NOISE_DEG,
    ]);
  })();

  it('defeats naive jitter: the mean converges on the true position', () => {
    const rand = mulberry32(99);
    const degPerMetre = 1 / 111_320;
    const jittered = trueFixes.map(([lon, lat]): LonLat => [
      lon + (rand() - 0.5) * 2 * RADIUS * degPerMetre,
      lat + (rand() - 0.5) * 2 * RADIUS * degPerMetre,
    ]);

    const errorAt = (n: number) => haversineM(JAKARTA, meanOf(jittered.slice(0, n)));

    const few = errorAt(25);
    const many = errorAt(SAMPLES);

    assert.ok(
      many < few / 5,
      `jitter should wash out: ${few.toFixed(0)}m at N=25 -> ${many.toFixed(0)}m at N=${SAMPLES}`,
    );
    assert.ok(many < 50, `jitter localises the member to ${many.toFixed(0)}m — this is the attack`);
  });

  it('resists it: snapping yields one point, so the mean never improves', () => {
    const snapped = trueFixes.map((fix) => resolveCell(fix, RADIUS, SALT).centroid);

    const distinct = new Set(snapped.map((c) => c.join(',')));
    assert.equal(distinct.size, 1, 'a stationary member must broadcast exactly one coordinate');

    const errorAt = (n: number) => haversineM(JAKARTA, meanOf(snapped.slice(0, n)));

    const few = errorAt(25);
    const many = errorAt(SAMPLES);

    // The key property: 400x more samples buys the observer nothing.
    assert.ok(
      Math.abs(many - few) < 1,
      `error must not shrink with N: ${few.toFixed(1)}m -> ${many.toFixed(1)}m`,
    );
  });
});

describe('resolveAnchor hysteresis', () => {
  const base = (): FuzzAnchor => {
    const cell = resolveCell(JAKARTA, RADIUS, `${SALT}:s0`);
    return { cellKey: cell.key, centroid: cell.centroid, radiusM: RADIUS, phaseSalt: 's0' };
  };

  it('holds the anchor still through GPS noise', () => {
    const previous = base();
    const rand = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const wobble: LonLat = [
        JAKARTA[0] + (rand() - 0.5) * 0.0006,
        JAKARTA[1] + (rand() - 0.5) * 0.0006,
      ];
      const { changed } = resolveAnchor({
        precise: wobble,
        radiusM: RADIUS,
        phaseKey: SALT,
        previous,
      });
      assert.equal(changed, false, 'GPS noise must never move a fuzzy avatar');
    }
  });

  it('holds still across a cell boundary, which is what snapping alone cannot do', () => {
    // Walk outward in small steps and confirm the anchor survives past the
    // point where plain cell membership would have flipped.
    const previous = base();
    const cell = cellSizeM(RADIUS, JAKARTA[1]);
    const stepDeg = 50 / 111_320;

    let flippedAt: number | null = null;
    for (let step = 1; step <= 120; step += 1) {
      const moved: LonLat = [JAKARTA[0], JAKARTA[1] + step * stepDeg];
      const { changed } = resolveAnchor({
        precise: moved,
        radiusM: RADIUS,
        phaseKey: SALT,
        previous,
      });
      if (changed) {
        flippedAt = haversineM(previous.centroid, moved);
        break;
      }
    }

    assert.notEqual(flippedAt, null, 'the anchor must eventually follow a real departure');
    assert.ok(
      flippedAt! > cell * HYSTERESIS_FACTOR * 0.95,
      `anchor moved too eagerly at ${flippedAt!.toFixed(0)}m (cell ${cell.toFixed(0)}m)`,
    );
  });

  it('rebuilds the anchor when the user changes their fuzz radius', () => {
    const previous = base();
    const { anchor, changed } = resolveAnchor({
      precise: JAKARTA,
      radiusM: 5000,
      phaseKey: SALT,
      previous,
    });
    assert.equal(changed, true);
    assert.equal(anchor.radiusM, 5000);
    assert.notEqual(anchor.phaseSalt, previous.phaseSalt, 'a new scale gets a new lattice');
  });

  it('follows a genuine move to another neighbourhood', () => {
    const previous = base();
    const { anchor, changed } = resolveAnchor({
      precise: [106.8456, -6.2088], // ~4 km away
      radiusM: RADIUS,
      phaseKey: SALT,
      previous,
    });
    assert.equal(changed, true);
    assert.notEqual(anchor.cellKey, previous.cellKey);
  });
});
