import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MemberPresence } from '@haven/contracts';
import {
  applyBootstrap,
  applyLiveness,
  applyTrustChanged,
  applyUpdate,
  emptyPresence,
  isResolving,
  selectMappable,
} from '../src/state/presenceReducer.js';

const CIRCLE = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f80';
const MAYA = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f81';

const precise = (overrides: Partial<MemberPresence> = {}): MemberPresence => ({
  userId: MAYA,
  trustMode: 'precise',
  coordinate: [106.8272, -6.1751],
  radiusM: 12,
  activity: 'still',
  online: true,
  capturedAt: '2026-10-27T03:00:00.000Z',
  battery: { percent: 60, state: 'unplugged', powerSaving: false },
  ...overrides,
});

const booted = () =>
  applyBootstrap(emptyPresence, {
    circleId: CIRCLE,
    members: [precise()],
    profiles: [],
    serverTime: '2026-10-27T03:00:01.000Z',
  });

describe('withdrawing a position', () => {
  it('replaces rather than merges, so an omitted coordinate is really gone', () => {
    // The member went ghost; the server's projection simply has no coordinate.
    const { coordinate: _c, radiusM: _r, ...ghost } = precise({ trustMode: 'ghost' });
    const next = applyUpdate(booted(), { circleId: CIRCLE, member: ghost });

    assert.equal(next.circles[CIRCLE]?.members[MAYA]?.coordinate, undefined);
    assert.equal(selectMappable(next, CIRCLE).length, 0);
  });

  it('drops the coordinate the instant trust:changed arrives', () => {
    const next = applyTrustChanged(booted(), { circleId: CIRCLE, userId: MAYA, mode: 'ghost' });
    const member = next.circles[CIRCLE]?.members[MAYA];

    assert.ok(member);
    assert.equal('coordinate' in member, false, 'no stale key left behind');
    assert.equal('radiusM' in member, false);
    assert.equal(member.trustMode, 'ghost');
    assert.equal(selectMappable(next, CIRCLE).length, 0);
  });

  it('ignores an in-flight precise update until the post-change bootstrap', () => {
    // The race: Maya hides; a precise update sent a moment earlier arrives
    // after trust:changed. It must not put her back on the map.
    let state = applyTrustChanged(booted(), { circleId: CIRCLE, userId: MAYA, mode: 'ghost' });
    state = applyUpdate(state, {
      circleId: CIRCLE,
      member: precise({ capturedAt: '2026-10-27T03:00:05.000Z' }),
    });

    assert.equal(selectMappable(state, CIRCLE).length, 0);
    assert.equal(isResolving(state, CIRCLE, MAYA), true);
  });

  it('lets the fresh bootstrap end the quarantine', () => {
    let state = applyTrustChanged(booted(), {
      circleId: CIRCLE,
      userId: MAYA,
      mode: 'approximate',
    });
    state = applyBootstrap(state, {
      circleId: CIRCLE,
      members: [precise({ trustMode: 'approximate', coordinate: [106.83, -6.18], radiusM: 1000 })],
      profiles: [],
      serverTime: '2026-10-27T03:00:06.000Z',
    });

    assert.equal(isResolving(state, CIRCLE, MAYA), false);
    assert.deepEqual(state.circles[CIRCLE]?.members[MAYA]?.coordinate, [106.83, -6.18]);
  });
});

describe('ordering', () => {
  it('ignores an older fix that arrives after a newer one', () => {
    let state = applyUpdate(booted(), {
      circleId: CIRCLE,
      member: precise({ coordinate: [106.9, -6.2], capturedAt: '2026-10-27T03:05:00.000Z' }),
    });
    state = applyUpdate(state, {
      circleId: CIRCLE,
      member: precise({ coordinate: [106.1, -6.1], capturedAt: '2026-10-27T03:02:00.000Z' }),
    });

    assert.deepEqual(state.circles[CIRCLE]?.members[MAYA]?.coordinate, [106.9, -6.2]);
  });
});

describe('liveness', () => {
  it('changes online and leaves everything else alone', () => {
    const next = applyLiveness(booted(), { circleId: CIRCLE, userId: MAYA, online: false });
    const member = next.circles[CIRCLE]?.members[MAYA];

    assert.equal(member?.online, false);
    assert.deepEqual(member?.coordinate, [106.8272, -6.1751]);
  });

  it('ignores liveness for a member it has never seen', () => {
    const state = booted();
    assert.equal(applyLiveness(state, { circleId: CIRCLE, userId: CIRCLE, online: true }), state);
  });
});

describe('bootstrap', () => {
  it('removes members who are no longer in the circle', () => {
    const next = applyBootstrap(booted(), {
      circleId: CIRCLE,
      members: [],
      profiles: [],
      serverTime: '2026-10-27T03:10:00.000Z',
    });
    assert.deepEqual(next.circles[CIRCLE]?.members, {});
  });
});
