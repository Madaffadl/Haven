import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CircleSummary, Invite, InvitePreview, Me } from '@haven/contracts';

import { ApiRequestError } from '../src/core/api/createClient.js';
import {
  errorCopy,
  formatInviteCode,
  inviteLink,
  inviteMessage,
  inviteTerms,
  joinSummary,
  spokenInviteCode,
} from '../src/features/onboarding/copy.js';
import {
  applyCircleJoined,
  applyMe,
  applySignedIn,
  applySignedOut,
  initialSession,
  stageOf,
  type SessionState,
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
  id: `0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f1${n}`,
  name: `Circle ${n}`,
  kind: 'family',
  role: 'owner',
  memberCount: 1,
  maxMembers: 8,
  ...overrides,
});

const signedOut: SessionState = { ...initialSession, status: 'signedOut' };

describe('session stage', () => {
  it('holds the splash while restoring, then signs out without tokens', () => {
    assert.equal(stageOf(initialSession), 'restoring');
    assert.equal(stageOf(signedOut), 'auth');
  });

  it('asks a new account for its name before anything else', () => {
    const state = applySignedIn(signedOut, { me: ME, circles: [], isNewUser: true });
    assert.equal(stageOf(state), 'name');
    assert.equal(stageOf(applyMe(state, { ...ME, displayName: 'Maya Putri' })), 'circle');
  });

  it('sends a returning user with a circle straight to the map', () => {
    const state = applySignedIn(signedOut, { me: ME, circles: [circle(1)], isNewUser: false });
    assert.equal(stageOf(state), 'app');
    assert.equal(state.activeCircleId, circle(1).id);
  });

  it('reaches the map once a circle is created or joined', () => {
    const state = applySignedIn(signedOut, { me: ME, circles: [], isNewUser: false });
    assert.equal(stageOf(state), 'circle');
    assert.equal(stageOf(applyCircleJoined(state, circle(1))), 'app');
  });

  it('treats an unreachable server as its own stage, not a sign-out', () => {
    assert.equal(stageOf({ ...initialSession, status: 'unreachable' }), 'unreachable');
  });
});

describe('session transitions', () => {
  it('keeps the circle on screen across a restore when it still exists', () => {
    const before = { ...signedOut, activeCircleId: circle(2).id };
    const state = applySignedIn(before, {
      me: ME,
      circles: [circle(1), circle(2)],
      isNewUser: false,
    });
    assert.equal(state.activeCircleId, circle(2).id);
  });

  it('falls back to the first circle when the active one is gone', () => {
    const before = { ...signedOut, activeCircleId: circle(9).id };
    const state = applySignedIn(before, { me: ME, circles: [circle(1)], isNewUser: false });
    assert.equal(state.activeCircleId, circle(1).id);
  });

  it('shows a joined circle and clears the invite that led to it', () => {
    const before = applySignedIn(
      { ...signedOut, pendingInviteCode: 'K7M2QX' },
      { me: ME, circles: [circle(1)], isNewUser: false },
    );
    const state = applyCircleJoined(before, circle(2));
    assert.equal(state.activeCircleId, circle(2).id);
    assert.equal(state.circles.length, 2);
    assert.equal(state.pendingInviteCode, null);
  });

  it('does not duplicate a circle joined twice', () => {
    const before = applySignedIn(signedOut, { me: ME, circles: [circle(1)], isNewUser: false });
    const state = applyCircleJoined(before, circle(1, { memberCount: 2 }));
    assert.equal(state.circles.length, 1);
    assert.equal(state.circles[0]!.memberCount, 2);
  });

  it('forgets the account on sign-out but keeps an unopened invite', () => {
    const before = applySignedIn(
      { ...signedOut, pendingInviteCode: 'K7M2QX' },
      { me: ME, circles: [circle(1)], isNewUser: false },
    );
    const state = applySignedOut(before);
    assert.equal(state.me, null);
    assert.deepEqual(state.circles, []);
    assert.equal(state.activeCircleId, null);
    assert.equal(state.pendingInviteCode, 'K7M2QX');
    assert.equal(stageOf(state), 'auth');
  });
});

describe('onboarding copy', () => {
  it('turns every API error into calm, specific copy', () => {
    const err = (code: ConstructorParameters<typeof ApiRequestError>[1], retryAfterMs?: number) =>
      new ApiRequestError(400, code, 'x', retryAfterMs);

    assert.match(errorCopy(err('network')), /connection/);
    assert.match(errorCopy(err('invalid_code')), /isn't right/);
    assert.match(errorCopy(err('code_expired')), /expired/);
    assert.match(errorCopy(err('invite_invalid')), /new code/);
    assert.match(errorCopy(err('circle_full')), /full/);
    assert.equal(errorCopy(err('rate_limited', 90_000)), 'Too many tries. Try again in 2 min.');
    assert.match(errorCopy(err('rate_limited')), /Wait a moment/);
    assert.equal(errorCopy(new Error('boom')), 'Something went wrong. Try again.');
  });

  it('formats codes for reading aloud and for screen readers', () => {
    assert.equal(formatInviteCode('K7M2QX'), 'K7M 2QX');
    assert.equal(spokenInviteCode('K7M2QX'), 'K 7 M 2 Q X');
  });

  it('puts the code and a deep link in the share message', () => {
    const couple = inviteMessage({ code: 'K7M2QX', circleName: 'Us', kind: 'couple' });
    assert.match(couple, /K7M2QX/);
    assert.ok(couple.includes(inviteLink('K7M2QX')));
    assert.equal(inviteLink('K7M2QX'), 'haven://join/K7M2QX');

    const family = inviteMessage({ code: 'K7M2QX', circleName: 'Keluarga Putri', kind: 'family' });
    assert.match(family, /"Keluarga Putri"/);
  });

  it('describes how far an invite reaches', () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0);
    const invite = (maxUses: number): Invite => ({
      code: 'K7M2QX',
      circleId: circle(1).id,
      maxUses,
      expiresAt: new Date(now + 24 * 3_600_000).toISOString(),
    });
    assert.equal(inviteTerms(invite(1), now), 'Works once · expires in 24 h');
    assert.equal(inviteTerms(invite(7), now), 'Up to 7 people · expires in 24 h');
  });

  it('says who the invitee will share with before they join', () => {
    const preview = (memberCount: number): InvitePreview => ({
      circleId: circle(1).id,
      circleName: 'Us',
      kind: 'couple',
      inviterName: 'Rizal',
      memberCount,
      maxMembers: 8,
      alreadyMember: false,
    });
    assert.equal(
      joinSummary(preview(1)),
      "Rizal invited you. You'll share your location, battery and local weather with them.",
    );
    assert.match(joinSummary(preview(3)), /with the 3 people in this circle/);
  });
});
