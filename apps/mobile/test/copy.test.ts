import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MemberPresence, MemberProfile } from '@haven/contracts';
import {
  initialsColor,
  initialsOf,
  isStale,
  localTime,
  locationPhrase,
  markerAccessibilityLabel,
  relativeAge,
} from '../src/features/map/presenceCopy.js';
import { contrastRatio } from '../src/ui/theme/contrast.js';

const NOW = Date.parse('2026-10-27T03:30:00.000Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const maya: MemberProfile = {
  userId: '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f81',
  displayName: 'Maya Putri',
  nickname: null,
  avatarUrl: null,
  accentHex: '#FFB4A2',
};

const member = (overrides: Partial<MemberPresence> = {}): MemberPresence => ({
  userId: maya.userId,
  trustMode: 'precise',
  coordinate: [106.8272, -6.1751],
  radiusM: 12,
  activity: 'still',
  online: true,
  capturedAt: ago(2),
  battery: { percent: 15, state: 'unplugged', powerSaving: true },
  weather: { code: 63, temperatureC: 24.4, isDay: true, observedAt: ago(5) },
  ...overrides,
});

describe('accessibility label', () => {
  it('carries everything the avatar shows, without colour', () => {
    assert.equal(
      markerAccessibilityLabel(member(), maya, NOW),
      'Maya Putri. battery 15 percent, low, low power mode on. raining, 24 degrees. exact location',
    );
  });

  it('adds "last seen" only once the fix is stale', () => {
    const label = markerAccessibilityLabel(member({ capturedAt: ago(45) }), maya, NOW);
    assert.match(label, /last seen 45 min ago$/);
  });

  it('says offline before anything else', () => {
    const label = markerAccessibilityLabel(member({ online: false }), maya, NOW);
    assert.match(label, /^Maya Putri\. offline\./);
  });

  it('prefers the per-circle nickname', () => {
    const label = markerAccessibilityLabel(member(), { ...maya, nickname: 'Mama' }, NOW);
    assert.match(label, /^Mama\./);
  });
});

describe('location phrasing never overclaims', () => {
  it('describes an approximate member as an area with its size', () => {
    assert.equal(
      locationPhrase(member({ trustMode: 'approximate', radiusM: 2000 })),
      'approximate area, within 2 km',
    );
  });

  it('says "hidden" for ghost, not "unavailable"', () => {
    // "Unavailable" sounds like a fault; ghost is a choice the member made.
    const { coordinate: _c, ...ghost } = member({ trustMode: 'ghost' });
    assert.equal(locationPhrase(ghost), 'location hidden');
  });
});

describe('staleness and age', () => {
  it('is stale past twenty minutes', () => {
    assert.equal(isStale(ago(19), NOW), false);
    assert.equal(isStale(ago(21), NOW), true);
    assert.equal(isStale(undefined, NOW), true);
  });

  it('reads naturally', () => {
    assert.equal(relativeAge(ago(0), NOW), 'just now');
    assert.equal(relativeAge(ago(12), NOW), '12 min ago');
    assert.equal(relativeAge(ago(180), NOW), '3 hr ago');
    assert.equal(relativeAge(ago(60 * 26), NOW), 'yesterday');
  });
});

describe('local time', () => {
  // 03:30 UTC on 27 Oct 2026.
  it('shows the time in their zone', () => {
    assert.deepEqual(localTime('Asia/Jakarta', NOW, 'Asia/Jakarta'), {
      time: '10:30 AM',
      dayHint: null,
    });
  });

  it('flags when it is already tomorrow for them', () => {
    // 03:30 UTC is 16:30 in Auckland (NZDT, +13) but 20:30 the previous
    // evening in Los Angeles (PDT, −7).
    assert.equal(localTime('Pacific/Auckland', NOW, 'America/Los_Angeles')?.dayHint, 'tomorrow');
    assert.equal(localTime('America/Los_Angeles', NOW, 'Pacific/Auckland')?.dayHint, 'yesterday');
  });

  it('degrades to nothing for an unknown zone instead of throwing', () => {
    assert.equal(localTime('Mars/Olympus_Mons', NOW, 'Asia/Jakarta'), null);
    assert.equal(localTime(undefined, NOW, 'Asia/Jakarta'), null);
  });
});

describe('initials', () => {
  it('takes first and last initials', () => {
    assert.equal(initialsOf('Maya Putri'), 'MP');
    assert.equal(initialsOf('  rizal  '), 'R');
  });

  it('picks whichever of ink or white reads better on any accent', () => {
    for (const accent of ['#FFB4A2', '#7CF5C8', '#1D2750', '#B91C1C', '#FFFFFF', '#000000']) {
      const chosen = initialsColor(accent);
      const other = chosen === '#0A0F24' ? '#F4F6FF' : '#0A0F24';
      assert.ok(
        contrastRatio(chosen, accent) >= contrastRatio(other, accent),
        `${accent}: picked the weaker of the two`,
      );
    }
  });
});
