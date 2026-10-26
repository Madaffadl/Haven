import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Coordinate } from '@haven/contracts';
import { resolveCell, type FuzzAnchor } from '../src/domain/location/fuzz.js';
import {
  hasMaterialChange,
  projectPresence,
  type SubjectState,
} from '../src/domain/location/project.js';

const HOME: Coordinate = [106.8272, -6.1751];
const USER = '11111111-1111-4111-8111-111111111111';

const subject = (overrides: Partial<SubjectState> = {}): SubjectState => ({
  userId: USER,
  precise: HOME,
  accuracyM: 12,
  activity: 'still',
  battery: { percent: 63, state: 'unplugged', powerSaving: false },
  weather: { code: 61, temperatureC: 28.4, isDay: true, observedAt: '2026-10-27T03:00:00.000Z' },
  timezone: 'Asia/Jakarta',
  capturedAt: new Date('2026-10-27T03:01:00.000Z'),
  ...overrides,
});

const anchorFor = (radiusM: number): FuzzAnchor => {
  const cell = resolveCell(HOME, radiusM, 'phase');
  return { cellKey: cell.key, centroid: cell.centroid, radiusM, phaseSalt: 'phase' };
};

/**
 * The single most important property in the codebase: for any mode other than
 * 'precise', the real coordinate must not appear anywhere in the emitted object.
 * Serialising the whole payload and searching it is a blunt check, and that is
 * the point — it catches a leak through any field, including one added later
 * by someone who never read this file.
 */
const assertNoPreciseLeak = (payload: unknown) => {
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes('106.8272'), 'precise longitude leaked into payload');
  assert.ok(!serialised.includes('-6.1751'), 'precise latitude leaked into payload');
};

describe('projectPresence', () => {
  it('passes the real coordinate through in precise mode', () => {
    const result = projectPresence({
      subject: subject(),
      mode: 'precise',
      anchor: null,
      online: true,
    });
    assert.deepEqual(result.coordinate, HOME);
    assert.equal(result.radiusM, 12);
  });

  it('emits the cell centroid, never the real point, in approximate mode', () => {
    const anchor = anchorFor(1000);
    const result = projectPresence({
      subject: subject(),
      mode: 'approximate',
      anchor,
      online: true,
    });

    assert.deepEqual(result.coordinate, anchor.centroid);
    assert.equal(result.radiusM, 1000, 'the ring must show the fuzz radius, not GPS accuracy');
    assertNoPreciseLeak(result);
  });

  it('fails closed when approximate mode has no anchor yet', () => {
    // The alternative — falling back to the precise point — would turn a
    // missing cache row into a location leak.
    const result = projectPresence({
      subject: subject(),
      mode: 'approximate',
      anchor: null,
      online: true,
    });

    assert.equal(result.coordinate, undefined);
    assert.equal(result.radiusM, undefined);
    assertNoPreciseLeak(result);
  });

  it('emits no position at all in ghost mode', () => {
    const result = projectPresence({
      subject: subject(),
      mode: 'ghost',
      anchor: anchorFor(1000),
      online: true,
    });

    assert.equal(result.coordinate, undefined);
    assertNoPreciseLeak(result);
  });

  it('withholds the timezone in ghost mode', () => {
    // "It's 3am there" is a coarse longitude signal. A member who hid their
    // position did not agree to disclose it sideways.
    const ghost = projectPresence({
      subject: subject(),
      mode: 'ghost',
      anchor: null,
      online: true,
    });
    assert.equal(ghost.timezone, undefined);

    const fuzzy = projectPresence({
      subject: subject(),
      mode: 'approximate',
      anchor: anchorFor(1000),
      online: true,
    });
    assert.equal(fuzzy.timezone, 'Asia/Jakarta');
  });

  it('still carries context when the position is hidden', () => {
    // This is the product thesis: even fully hidden, "42%, raining, 11pm
    // there" answers why they haven't replied.
    const result = projectPresence({
      subject: subject(),
      mode: 'ghost',
      anchor: null,
      online: true,
    });

    assert.equal(result.battery?.percent, 65);
    assert.equal(result.weather?.code, 61);
  });

  it('quantises battery to 5% buckets', () => {
    const result = projectPresence({
      subject: subject({ battery: { percent: 63, state: 'unplugged', powerSaving: false } }),
      mode: 'precise',
      anchor: null,
      online: true,
    });
    assert.equal(result.battery?.percent, 65);
  });
});

describe('hasMaterialChange', () => {
  const base = () =>
    projectPresence({
      subject: subject(),
      mode: 'approximate',
      anchor: anchorFor(1000),
      online: true,
    });

  it('suppresses a repeat broadcast for a stationary fuzzy member', () => {
    // The whole fan-out saving: a member sitting at home in Approximate mode
    // produces an identical projection every report, so the circle's radios
    // stay asleep.
    assert.equal(hasMaterialChange(base(), base()), false);
  });

  it('always broadcasts the first update', () => {
    assert.equal(hasMaterialChange(null, base()), true);
  });

  it('broadcasts when battery crosses a bucket', () => {
    const next = projectPresence({
      subject: subject({ battery: { percent: 54, state: 'unplugged', powerSaving: false } }),
      mode: 'approximate',
      anchor: anchorFor(1000),
      online: true,
    });
    assert.equal(hasMaterialChange(base(), next), true);
  });

  it('ignores battery drift inside a bucket', () => {
    const next = projectPresence({
      subject: subject({ battery: { percent: 64, state: 'unplugged', powerSaving: false } }),
      mode: 'approximate',
      anchor: anchorFor(1000),
      online: true,
    });
    assert.equal(hasMaterialChange(base(), next), false);
  });

  it('broadcasts when trust mode changes', () => {
    const next = projectPresence({
      subject: subject(),
      mode: 'ghost',
      anchor: null,
      online: true,
    });
    assert.equal(hasMaterialChange(base(), next), true);
  });

  it('broadcasts when a member goes offline', () => {
    const next = projectPresence({
      subject: subject(),
      mode: 'approximate',
      anchor: anchorFor(1000),
      online: false,
    });
    assert.equal(hasMaterialChange(base(), next), true);
  });
});
