import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ACCENT_COLORS, type CircleSummary, type DeviceSummary, type Me } from '@haven/contracts';

import {
  ACCENT_NAMES,
  DELETE_CONFIRMATION,
  circleMeta,
  deviceActivity,
  deviceDescription,
  leaveConfirmation,
} from '../src/features/settings/settingsCopy.js';
import {
  applyCircleLeft,
  applySignedIn,
  initialSession,
  stageOf,
} from '../src/state/sessionReducer.js';

const ME: Me = {
  userId: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f01',
  email: 'maya@mail.com',
  displayName: 'Maya',
  avatarUrl: null,
  accentHex: '#B9A7FF',
  trustMode: 'precise',
};

const circle = (n: number, overrides: Partial<CircleSummary> = {}): CircleSummary => ({
  id: `0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f2${n}`,
  name: `Circle ${n}`,
  kind: 'family',
  role: 'member',
  memberCount: 3,
  maxMembers: 8,
  ...overrides,
});

const device = (overrides: Partial<DeviceSummary> = {}): DeviceSummary => ({
  deviceId: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f30',
  platform: 'ios',
  osVersion: '27.0',
  appVersion: '1.0.0',
  signedInAt: '2026-10-01T08:00:00.000Z',
  lastActiveAt: '2026-10-30T09:00:00.000Z',
  current: false,
  ...overrides,
});

describe('leaving a circle', () => {
  const signedOut = { ...initialSession, status: 'signedOut' as const };

  it('moves to another circle when the one on screen is left', () => {
    const state = applySignedIn(signedOut, {
      me: ME,
      circles: [circle(1), circle(2)],
      isNewUser: false,
    });
    const after = applyCircleLeft(state, circle(1).id);
    assert.equal(after.activeCircleId, circle(2).id);
    assert.equal(stageOf(after), 'app');
  });

  it('keeps the circle on screen when a different one is left', () => {
    const state = {
      ...applySignedIn(signedOut, { me: ME, circles: [circle(1), circle(2)], isNewUser: false }),
      activeCircleId: circle(2).id,
    };
    assert.equal(applyCircleLeft(state, circle(1).id).activeCircleId, circle(2).id);
  });

  it('returns to create-or-join after leaving the last circle', () => {
    const state = applySignedIn(signedOut, { me: ME, circles: [circle(1)], isNewUser: false });
    const after = applyCircleLeft(state, circle(1).id);
    assert.equal(after.activeCircleId, null);
    assert.equal(stageOf(after), 'circle');
  });
});

describe('settings copy', () => {
  it('names every accent for screen readers', () => {
    for (const hex of ACCENT_COLORS) assert.ok(ACCENT_NAMES[hex], hex);
  });

  it('summarises a circle', () => {
    assert.equal(circleMeta(circle(1)), 'Family · 3 of 8');
    assert.equal(
      circleMeta(circle(1, { kind: 'couple', memberCount: 2, maxMembers: 2 })),
      'Couple · 2 of 2',
    );
  });

  it('describes devices with whatever they reported', () => {
    assert.equal(deviceDescription(device()), 'iOS 27.0 · Haven 1.0.0');
    assert.equal(
      deviceDescription(device({ platform: 'android', osVersion: null, appVersion: null })),
      'Android',
    );
    assert.equal(deviceActivity(device({ current: true }), Date.now()), 'This device');
    assert.match(deviceActivity(device(), Date.parse('2026-10-30T12:00:00.000Z')), /^Active /);
  });

  it('tells an owner the circle is handed on, and the last member it closes', () => {
    const owner = leaveConfirmation(circle(1, { role: 'owner', memberCount: 3 }));
    assert.equal(owner.title, 'Leave "Circle 1"?');
    assert.match(owner.message, /becomes its owner/);

    const last = leaveConfirmation(circle(1, { role: 'owner', memberCount: 1 }));
    assert.match(last.message, /circle will close/);
    assert.doesNotMatch(last.message, /becomes its owner/);

    for (const c of [circle(1), circle(1, { role: 'owner' })]) {
      assert.match(leaveConfirmation(c).message, /stop sharing your location/);
      assert.match(leaveConfirmation(c).message, /new invite/);
    }
  });

  it('says account deletion is permanent and erases location', () => {
    assert.match(DELETE_CONFIRMATION.message, /can't be undone/);
    assert.match(DELETE_CONFIRMATION.message, /location will be erased/);
    assert.match(DELETE_CONFIRMATION.message, /every device/);
  });
});
