import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  INVITE_CODE_ALPHABET,
  emailSchema,
  inviteCodeSchema,
  routes,
  signInCodeSchema,
} from '@haven/contracts';

import { defaultInviteUses, generateInviteCode } from '../src/domain/circle/inviteCode.js';
import { ACCENTS, defaultDisplayName, pickAccent } from '../src/domain/identity/profile.js';
import { hashRefreshToken, newRefreshToken } from '../src/domain/identity/refreshToken.js';
import {
  generateSignInCode,
  hashSignInCode,
  signInCodeMatches,
} from '../src/domain/identity/signInCode.js';

const SECRET = 'test-secret-test-secret-test-secret-00';

describe('sign-in codes', () => {
  it('are always six digits, leading zeros included', () => {
    for (let i = 0; i < 2_000; i += 1) {
      assert.ok(signInCodeSchema.safeParse(generateSignInCode()).success);
    }
  });

  it('match only the same code, address and secret', () => {
    const hash = hashSignInCode(SECRET, 'maya@mail.com', '042917');

    assert.equal(signInCodeMatches(hash, SECRET, 'maya@mail.com', '042917'), true);
    assert.equal(signInCodeMatches(hash, SECRET, 'maya@mail.com', '042918'), false);
    // A code sent to one inbox cannot be replayed for another account.
    assert.equal(signInCodeMatches(hash, SECRET, 'rizal@mail.com', '042917'), false);
    assert.equal(signInCodeMatches(hash, `${SECRET}x`, 'maya@mail.com', '042917'), false);
  });

  it('never stores the code in clear', () => {
    assert.ok(!hashSignInCode(SECRET, 'maya@mail.com', '042917').includes('042917'));
  });
});

describe('refresh tokens', () => {
  it('carry 256 bits and hash to 32 bytes', () => {
    const token = newRefreshToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashRefreshToken(token).length, 32);
  });

  it('hash deterministically, and differ every time', () => {
    const token = newRefreshToken();
    assert.deepEqual(hashRefreshToken(token), hashRefreshToken(token));
    assert.notEqual(newRefreshToken(), newRefreshToken());
  });

  it('fit the refresh request schema bounds', async () => {
    const { refreshSchema } = await import('@haven/contracts');
    assert.ok(refreshSchema.safeParse({ refreshToken: newRefreshToken() }).success);
  });
});

describe('new account defaults', () => {
  it('derives a presentable name from the address', () => {
    assert.equal(defaultDisplayName('maya.putri+haven@mail.com'), 'Maya Putri');
    assert.equal(defaultDisplayName('RIZAL_HAKIM@mail.com'), 'Rizal Hakim');
    assert.equal(defaultDisplayName('dimas99@mail.com'), 'Dimas');
  });

  it('falls back when the address has nothing name-like', () => {
    assert.equal(defaultDisplayName('12345@mail.com'), 'Haven member');
    assert.equal(defaultDisplayName('...@mail.com'), 'Haven member');
  });

  it('stays inside the 40-character column limit', () => {
    assert.ok(defaultDisplayName(`${'a'.repeat(80)}@mail.com`).length <= 40);
  });

  it('picks accents the users table accepts', () => {
    for (const accent of ACCENTS) assert.match(accent, /^#[0-9a-f]{6}$/i);
    assert.ok((ACCENTS as readonly string[]).includes(pickAccent()));
  });
});

describe('invite codes', () => {
  // The migration is the authority: a code the CHECK rejects is a 500 at insert.
  const migration = readFileSync(
    new URL('../../../infra/db/migrations/0003_circles.sql', import.meta.url),
    'utf8',
  );
  const sqlPattern = /code\s+citext NOT NULL CHECK \(code ~ '([^']+)'\)/.exec(migration)?.[1];

  it('use the same pattern as the database CHECK', () => {
    assert.equal(sqlPattern, '^[A-HJ-NP-Z2-9]{6}$');
  });

  it('are always accepted by the database pattern', () => {
    const pattern = new RegExp(sqlPattern!);
    for (let i = 0; i < 2_000; i += 1) assert.match(generateInviteCode(), pattern);
  });

  it('avoid characters that are ambiguous read aloud', () => {
    assert.equal(INVITE_CODE_ALPHABET.length, 32);
    for (const ambiguous of ['O', '0', 'I', '1']) {
      assert.ok(!INVITE_CODE_ALPHABET.includes(ambiguous));
    }
  });

  it('accept what people actually type', () => {
    assert.equal(inviteCodeSchema.parse(' k7m 2qx '), 'K7M2QX');
    assert.equal(inviteCodeSchema.parse('K7M-2QX'), 'K7M2QX');
    assert.equal(inviteCodeSchema.safeParse('K7M2Q0').success, false);
    assert.equal(inviteCodeSchema.safeParse('K7M2Q').success, false);
    assert.equal(inviteCodeSchema.safeParse('../../x').success, false);
  });

  it('fill the open seats by default', () => {
    assert.equal(defaultInviteUses(1, 2), 1); // couple: one partner to invite
    assert.equal(defaultInviteUses(1, 8), 7); // family: one code for the group chat
    assert.equal(defaultInviteUses(2, 2), 1); // never zero, the CHECK forbids it
    assert.equal(defaultInviteUses(0, 16), 16);
    assert.equal(defaultInviteUses(0, 40), 20); // capped by the CHECK
  });
});

describe('REST contracts', () => {
  it('normalise email before validating it', () => {
    assert.equal(emailSchema.parse('  Maya@Mail.COM '), 'maya@mail.com');
    assert.equal(emailSchema.safeParse('maya@').success, false);
  });

  it('keep route parameters raw for the server to register', () => {
    assert.equal(routes.invite(':code'), '/v1/invites/:code');
    assert.equal(routes.acceptInvite(':code'), '/v1/invites/:code/accept');
    assert.equal(routes.circleInvites(':circleId'), '/v1/circles/:circleId/invites');
  });
});

describe('access tokens', async () => {
  // lib/token reads JWT_SECRET through config/env, which validates the whole
  // environment at import time. Placeholder URLs satisfy it; nothing connects.
  process.env['DATABASE_URL'] ??= 'postgres://test@localhost:5432/test';
  process.env['REDIS_URL'] ??= 'redis://localhost:6379';
  process.env['JWT_SECRET'] = SECRET;

  const { signAccessToken, verifyAccessToken } = await import('../src/lib/token.js');

  const claims = {
    sub: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f01',
    sid: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f02',
    did: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f03',
    scope: 'app' as const,
  };

  it('round-trip through verification', () => {
    const { token } = signAccessToken(claims);
    const verified = verifyAccessToken(token);
    assert.ok(verified);
    assert.equal(verified.sub, claims.sub);
    assert.equal(verified.sid, claims.sid);
    assert.equal(verified.did, claims.did);
    assert.equal(verified.scope, 'app');
  });

  it('report the expiry they were signed with', () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0);
    const { expiresAt } = signAccessToken(claims, 900, now);
    assert.equal(expiresAt.getTime(), now + 900_000);
  });

  it('are rejected once expired', () => {
    const { token } = signAccessToken(claims, 60, Date.now() - 120_000);
    assert.equal(verifyAccessToken(token), null);
  });

  it('are rejected when the payload is altered', () => {
    const { token } = signAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, sub: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f09', iat: 0, exp: 9e9 }),
    ).toString('base64url');
    assert.equal(verifyAccessToken(`${header}.${forged}.${signature}`), null);
  });

  it('are rejected under a different algorithm header', () => {
    const { token } = signAccessToken(claims);
    const [, payload, signature] = token.split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    assert.equal(verifyAccessToken(`${none}.${payload}.${signature}`), null);
  });
});
