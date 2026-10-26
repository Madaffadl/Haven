import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boundsFor, circlePolygon, distanceM, fanOut } from '../src/features/map/geometry.js';
import {
  nearestSnapIndex,
  projectedEnd,
  resistedPosition,
  rubberBand,
  snapHeightsToY,
} from '../src/ui/primitives/sheetPhysics.js';

// Peek, half, full — the sheet's three heights on a 844pt-tall phone.
const SNAP_YS = snapHeightsToY([132, 380, 740]);

describe('sheet snapping', () => {
  it('converts heights to translateY with the tallest at 0', () => {
    assert.deepEqual(SNAP_YS, [608, 360, 0]);
  });

  it('a slow release snaps to whatever is nearest', () => {
    assert.equal(nearestSnapIndex(projectedEnd(400, 0), SNAP_YS), 1);
  });

  it('a short fast upward flick expands, even from near peek', () => {
    // Finger moved ~30pt but at -1500pt/s: the intent is "open it".
    const releasedAt = 578;
    assert.equal(nearestSnapIndex(projectedEnd(releasedAt, -1500), SNAP_YS), 2);
  });

  it('a downward flick from full collapses past half', () => {
    assert.equal(nearestSnapIndex(projectedEnd(40, 2200), SNAP_YS), 0);
  });
});

describe('rubber band', () => {
  it('passes through inside bounds', () => {
    assert.equal(resistedPosition(300, 0, 608, 844), 300);
  });

  it('resists, never blocks, past the top', () => {
    const y = resistedPosition(-200, 0, 608, 844);
    assert.ok(y < 0, 'still moves with the finger');
    assert.ok(y > -200, 'but less than the finger did');
  });

  it('gives diminishing returns the further you pull', () => {
    const first = Math.abs(rubberBand(-100, 844));
    const second = Math.abs(rubberBand(-200, 844)) - first;
    assert.ok(second < first, 'the second 100pt moves the sheet less than the first');
  });

  it('is bounded by the dimension however hard you pull', () => {
    assert.ok(Math.abs(rubberBand(-100_000, 844)) < 844);
  });
});

describe('ground circles', () => {
  it('draws a closed ring whose vertices are the requested distance out', () => {
    const center: [number, number] = [106.8272, -6.1751];
    const ring = circlePolygon(center, 1000);

    assert.deepEqual(ring[0], ring[ring.length - 1], 'GeoJSON ring must be closed');
    for (const vertex of ring) {
      const d = distanceM(center, vertex);
      assert.ok(Math.abs(d - 1000) < 1, `vertex at ${d.toFixed(2)}m, expected 1000m`);
    }
  });

  it('stays a true ground circle at high latitude', () => {
    const tromso: [number, number] = [18.9553, 69.6492];
    for (const vertex of circlePolygon(tromso, 2000, 32)) {
      assert.ok(Math.abs(distanceM(tromso, vertex) - 2000) < 2);
    }
  });
});

describe('fan-out', () => {
  const HOME: [number, number] = [106.8272, -6.1751];

  it('separates two people at the same address', () => {
    const offsets = fanOut([
      { userId: 'b', coordinate: HOME },
      { userId: 'a', coordinate: HOME },
    ]);
    assert.notDeepEqual(offsets.get('a'), offsets.get('b'));
  });

  it('leaves a lone member exactly on their point', () => {
    assert.deepEqual(fanOut([{ userId: 'a', coordinate: HOME }]).get('a'), { dx: 0, dy: 0 });
  });

  it('is stable regardless of input order', () => {
    const forward = fanOut([
      { userId: 'a', coordinate: HOME },
      { userId: 'b', coordinate: HOME },
    ]);
    const backward = fanOut([
      { userId: 'b', coordinate: HOME },
      { userId: 'a', coordinate: HOME },
    ]);
    assert.deepEqual(forward.get('a'), backward.get('a'));
  });

  it('does not group people a street apart', () => {
    const offsets = fanOut([
      { userId: 'a', coordinate: HOME },
      { userId: 'b', coordinate: [106.8312, -6.1751] }, // ~440 m east
    ]);
    assert.deepEqual(offsets.get('a'), { dx: 0, dy: 0 });
    assert.deepEqual(offsets.get('b'), { dx: 0, dy: 0 });
  });
});

describe('camera bounds', () => {
  it('pads a single point into a viewable neighbourhood', () => {
    const b = boundsFor([[106.8272, -6.1751]]);
    assert.ok(b);
    assert.ok(b.ne[0] - b.sw[0] >= 0.01 - 1e-12);
  });

  it('returns null with nobody to show', () => {
    assert.equal(boundsFor([]), null);
  });
});
