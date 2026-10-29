import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FUZZ_RADIUS_M, meSchema, trustModeSchema, type Me } from '@haven/contracts';

import { RealtimeRequestError } from '../src/core/realtime/socket.js';
import {
  TRUST_OPTIONS,
  selfPrivacyPhrase,
  trustErrorCopy,
  trustLabel,
} from '../src/features/trust-mode/trustCopy.js';
import {
  applyMe,
  applySignedIn,
  applySignedOut,
  applyTrustMode,
  initialSession,
} from '../src/state/sessionReducer.js';

const ME: Me = {
  userId: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f01',
  email: 'maya@mail.com',
  displayName: 'Maya',
  avatarUrl: null,
  accentHex: '#B9A7FF',
  trustMode: 'approximate',
};

describe('trust mode options', () => {
  it('offer every mode the server knows, in order from least to most private', () => {
    assert.deepEqual(
      TRUST_OPTIONS.map((o) => o.mode),
      trustModeSchema.options,
    );
  });

  it('state the area an approximate circle actually sees', () => {
    // The disc has the neighbourhood radius; the area it stands for is twice
    // that across. Copy that said "1 km" would understate what is shared.
    const km = (FUZZ_RADIUS_M.neighbourhood * 2) / 1000;
    const approximate = TRUST_OPTIONS.find((o) => o.mode === 'approximate')!;
    assert.match(approximate.summary, new RegExp(`about ${km} km wide`));
    assert.match(approximate.summary, /Never your exact spot/);
  });

  it('tell a hidden member that their circle still knows they are okay', () => {
    const hidden = TRUST_OPTIONS.find((o) => o.mode === 'ghost')!;
    assert.equal(hidden.label, 'Hidden');
    assert.match(hidden.summary, /battery and weather/);
  });

  it('label each mode for the chip', () => {
    assert.equal(trustLabel('precise'), 'Precise');
    assert.equal(trustLabel('approximate'), 'Approximate');
    assert.equal(trustLabel('ghost'), 'Hidden');
  });

  it('speak a privacy note on your own marker only when you share less', () => {
    assert.equal(selfPrivacyPhrase('precise'), null);
    assert.match(selfPrivacyPhrase('approximate')!, /approximate area/);
    assert.match(selfPrivacyPhrase('ghost')!, /Hidden/);
  });
});

describe('trust mode errors', () => {
  it('always say that nothing changed', () => {
    for (const code of [
      'offline',
      'timeout',
      'rate_limited',
      'internal',
      'not_a_member',
    ] as const) {
      assert.match(trustErrorCopy(new RealtimeRequestError(code, 'x')), /nothing changed/);
    }
    assert.match(trustErrorCopy(new Error('boom')), /nothing changed/);
  });

  it('point at the connection when the server could not be reached', () => {
    assert.match(trustErrorCopy(new RealtimeRequestError('offline', 'x')), /connection/);
    assert.match(trustErrorCopy(new RealtimeRequestError('timeout', 'x')), /connection/);
  });
});

describe('trust mode in the session', () => {
  const signedOut = { ...initialSession, status: 'signedOut' as const };

  it('starts from what the server says, not from presence', () => {
    // Presence would say precise: the server shows everyone themselves that way.
    const state = applySignedIn(signedOut, { me: ME, circles: [], isNewUser: false });
    assert.equal(state.trustMode, 'approximate');
  });

  it('follows a confirmed change and a fresh profile', () => {
    const signedIn = applySignedIn(signedOut, { me: ME, circles: [], isNewUser: false });
    assert.equal(applyTrustMode(signedIn, 'ghost').trustMode, 'ghost');
    assert.equal(applyMe(signedIn, { ...ME, trustMode: 'precise' }).trustMode, 'precise');
  });

  it('forgets the previous account on sign-out', () => {
    const signedIn = applySignedIn(signedOut, { me: ME, circles: [], isNewUser: false });
    assert.equal(applySignedOut(signedIn).trustMode, 'precise');
  });

  it('is part of the profile contract', () => {
    assert.equal(meSchema.safeParse({ ...ME, trustMode: undefined }).success, false);
    assert.equal(meSchema.safeParse(ME).success, true);
  });
});
