import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { locationReportSchema, type MemberPresence } from '@haven/contracts';

import {
  DEFAULT_POLICY,
  buildReport,
  distanceM,
  inferActivity,
  policyChanged,
  selfPresence,
  shouldUpload,
  toBatteryContext,
  type Fix,
} from '../src/core/location/reportModel.js';

const KEMANG: [number, number] = [106.8136, -6.2615];
const AT = Date.UTC(2026, 9, 30, 12, 0, 0);

const fix = (overrides: Partial<Fix['coords']> = {}, timestamp = AT): Fix => ({
  coords: {
    latitude: KEMANG[1],
    longitude: KEMANG[0],
    accuracy: 12,
    altitude: 30,
    heading: 90,
    speed: 1.2,
    ...overrides,
  },
  timestamp,
});

const battery = { percent: 80, state: 'unplugged' as const, powerSaving: false };

describe('location reports', () => {
  it('match the contract the server validates', () => {
    const report = buildReport({ fix: fix(), battery, timezone: 'Asia/Jakarta' });
    assert.ok(locationReportSchema.safeParse(report).success);
  });

  it('put longitude first, as everywhere on the wire', () => {
    const report = buildReport({ fix: fix(), battery, timezone: 'Asia/Jakarta' });
    assert.deepEqual(report.coordinate, KEMANG);
  });

  it('carry the time the fix was taken, not the time it was sent', () => {
    const report = buildReport({ fix: fix({}, AT - 90_000), battery, timezone: 'Asia/Jakarta' });
    assert.equal(report.capturedAt, new Date(AT - 90_000).toISOString());
  });

  it('drop what the OS could not measure instead of sending nonsense', () => {
    const report = buildReport({
      fix: fix({ accuracy: null, altitude: null, heading: -1, speed: -1 }),
      battery,
      timezone: 'Asia/Jakarta',
    });
    assert.equal(report.accuracyM, 100); // unknown accuracy is treated as coarse
    assert.equal(report.altitudeM, undefined);
    assert.equal(report.headingDeg, undefined);
    assert.equal(report.speedMps, undefined);
    assert.equal(report.activity, 'unknown');
    assert.ok(locationReportSchema.safeParse(report).success);
  });
});

describe('activity from speed', () => {
  it('maps speed to the cadence rows of the upload policy', () => {
    assert.equal(inferActivity(null), 'unknown');
    assert.equal(inferActivity(0.1), 'still');
    assert.equal(inferActivity(1.4), 'walking');
    assert.equal(inferActivity(5), 'cycling');
    assert.equal(inferActivity(15), 'driving');
  });
});

describe('battery', () => {
  it('rounds to the 5% buckets the contract promises', () => {
    assert.deepEqual(
      toBatteryContext({ batteryLevel: 0.62, batteryState: 2, lowPowerMode: true }),
      {
        percent: 60,
        state: 'charging',
        powerSaving: true,
      },
    );
  });

  it('shows a simulator with no battery as full and unknown, not as empty', () => {
    const context = toBatteryContext({ batteryLevel: -1, batteryState: 0, lowPowerMode: false });
    assert.equal(context.percent, 100);
    assert.equal(context.state, 'unknown');
  });
});

describe('when to upload', () => {
  const sent = { at: AT, coordinate: KEMANG };
  const policy = { intervalMs: 5 * 60_000, distanceFilterM: 150, idle: false };

  it('always sends the first fix', () => {
    assert.equal(shouldUpload(null, sent, policy), true);
  });

  it('waits out the interval while standing still', () => {
    assert.equal(shouldUpload(sent, { at: AT + 60_000, coordinate: KEMANG }, policy), false);
    assert.equal(shouldUpload(sent, { at: AT + 5 * 60_000, coordinate: KEMANG }, policy), true);
  });

  it('sends early once the phone has moved past the distance filter', () => {
    const near: [number, number] = [KEMANG[0] + 0.0005, KEMANG[1]]; // ~55 m east
    const far: [number, number] = [KEMANG[0] + 0.002, KEMANG[1]]; // ~220 m east
    assert.equal(shouldUpload(sent, { at: AT + 30_000, coordinate: near }, policy), false);
    assert.equal(shouldUpload(sent, { at: AT + 30_000, coordinate: far }, policy), true);
  });

  it('measures distance on the ground', () => {
    const oneKmNorth: [number, number] = [KEMANG[0], KEMANG[1] + 0.008993];
    assert.ok(Math.abs(distanceM(KEMANG, oneKmNorth) - 1_000) < 2);
  });

  it('restarts OS updates only when the policy actually changed', () => {
    assert.equal(policyChanged(DEFAULT_POLICY, { ...DEFAULT_POLICY }), false);
    assert.equal(policyChanged(DEFAULT_POLICY, { ...DEFAULT_POLICY, idle: true }), true);
    assert.equal(policyChanged(DEFAULT_POLICY, { ...DEFAULT_POLICY, intervalMs: 30_000 }), true);
  });
});

describe('your own avatar', () => {
  it('moves to your fix at its accuracy, keeping the weather the server sent', () => {
    const report = buildReport({ fix: fix(), battery, timezone: 'Asia/Jakarta' });
    const weather = {
      code: 61,
      temperatureC: 27,
      isDay: true,
      observedAt: '2026-10-30T11:00:00.000Z',
    };
    const previous = {
      userId: 'me',
      trustMode: 'precise',
      online: true,
      activity: 'still',
      weather,
    } as MemberPresence;

    const self = selfPresence('me', report, previous);
    assert.deepEqual(self.coordinate, KEMANG);
    assert.equal(self.radiusM, 12);
    assert.equal(self.trustMode, 'precise');
    assert.deepEqual(self.weather, weather);
    assert.equal(self.capturedAt, report.capturedAt);
  });
});
