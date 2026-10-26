import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

import {
  isoInstant,
  locationReportSchema,
  presenceBootstrapSchema,
  sendNudgeSchema,
  trustSettingSchema,
  userId,
} from '@haven/contracts';

/**
 * Pins the runtime parsing behaviour the app depends on.
 *
 * Exists because of the zod 3 → 4 upgrade: most of zod 4's breaking changes
 * are behavioural (stricter UUIDs, new default semantics), so a clean
 * typecheck proves nothing about whether real payloads still parse. These
 * tests do.
 */

// A real UUIDv7: version nibble 7, variant bits 10xx.
const UUID_V7 = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f80';

const validReport = {
  coordinate: [106.8272, -6.1751],
  accuracyM: 12,
  battery: { percent: 63, state: 'unplugged', powerSaving: false },
  timezone: 'Asia/Jakarta',
  capturedAt: '2026-10-27T03:01:00.000Z',
};

describe('ids', () => {
  it('accepts the UUIDv7s that haven_uuidv7() and the client generate', () => {
    assert.equal(userId.safeParse(UUID_V7).success, true);
  });

  it('rejects hex that is UUID-shaped but not RFC 9562', () => {
    // zod 3 accepted this; zod 4's z.uuid() checks version and variant bits.
    // Pinned so a later switch to the permissive z.guid() is a deliberate act.
    assert.equal(userId.safeParse('11111111-1111-1111-1111-111111111111').success, false);
  });
});

describe('isoInstant', () => {
  it('accepts UTC and offset timestamps', () => {
    assert.equal(isoInstant.safeParse('2026-10-27T03:01:00.000Z').success, true);
    assert.equal(isoInstant.safeParse('2026-10-27T10:01:00+07:00').success, true);
  });

  it('rejects a space-separated, zone-less timestamp', () => {
    assert.equal(isoInstant.safeParse('2026-10-27 03:01:00').success, false);
  });
});

describe('locationReportSchema', () => {
  it('parses a real report and defaults activity to unknown', () => {
    const parsed = locationReportSchema.parse(validReport);
    assert.equal(parsed.activity, 'unknown');
  });

  it('rejects an out-of-range coordinate', () => {
    const result = locationReportSchema.safeParse({ ...validReport, coordinate: [200, -6.17] });
    assert.equal(result.success, false);
  });

  it('rejects a three-element coordinate', () => {
    // Guards the [lon, lat] tuple contract that Mapbox consumes directly.
    const result = locationReportSchema.safeParse({
      ...validReport,
      coordinate: [106.8, -6.1, 12],
    });
    assert.equal(result.success, false);
  });
});

describe('defaults', () => {
  it('fills the fuzz radius when the client omits it', () => {
    assert.equal(trustSettingSchema.parse({ mode: 'approximate' }).fuzzRadiusM, 1000);
  });
});

describe('sendNudgeSchema', () => {
  it('rejects a nudge kind outside the closed vocabulary', () => {
    const result = sendNudgeSchema.safeParse({
      circleId: UUID_V7,
      kind: 'poke',
      clientNudgeId: UUID_V7,
    });
    assert.equal(result.success, false);
  });
});

describe('array bounds (GHSA-mrhx-c7xc-m3w5 hardening)', () => {
  const member = { userId: UUID_V7, trustMode: 'ghost', online: false };
  const profile = {
    userId: UUID_V7,
    displayName: 'Maya',
    nickname: null,
    avatarUrl: null,
    accentHex: '#FFB4A2',
  };
  const bootstrap = (members: number, profiles: number) => ({
    circleId: UUID_V7,
    members: Array.from({ length: members }, () => member),
    profiles: Array.from({ length: profiles }, () => profile),
    serverTime: '2026-10-27T03:01:00.000Z',
  });

  it('accepts a full circle of 16', () => {
    // The control case: without it, the rejections below could be failing
    // for any unrelated reason and still look like passing bound checks.
    assert.equal(presenceBootstrapSchema.safeParse(bootstrap(16, 16)).success, true);
  });

  it('caps bootstrap members at the circle size ceiling', () => {
    assert.equal(presenceBootstrapSchema.safeParse(bootstrap(17, 16)).success, false);
  });

  it('caps bootstrap profiles at the same ceiling', () => {
    assert.equal(presenceBootstrapSchema.safeParse(bootstrap(16, 17)).success, false);
  });
});

describe('env URL validation', () => {
  // config/env.ts parses process.env at import time and exits on failure, so
  // the z.url() behaviour it relies on is pinned here directly: zod 4 rebuilt
  // URL validation, and a scheme it rejected would stop the server at boot.
  it('accepts the connection-string schemes the server boots with', () => {
    assert.equal(
      z.url().safeParse('postgres://haven:haven_dev@localhost:5432/haven').success,
      true,
    );
    assert.equal(z.url().safeParse('redis://localhost:6379').success, true);
  });
});
