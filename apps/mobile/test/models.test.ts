import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  batteryDescription,
  batteryTone,
  dashOffset,
  fillFraction,
  ringGeometry,
} from '../src/features/map/batteryModel.js';
import { glyphMotion, weatherDescription, weatherKind } from '../src/features/map/weatherModel.js';

const unplugged = (percent: number) => ({
  percent,
  state: 'unplugged' as const,
  powerSaving: false,
});

describe('battery ring geometry', () => {
  it('keeps the stroke inside the box', () => {
    const g = ringGeometry(54, 3);
    assert.equal(g.radius, 25.5);
    assert.ok(Math.abs(g.circumference - 2 * Math.PI * 25.5) < 1e-9);
  });

  it('maps 100% to a closed ring and 0% to an empty one', () => {
    const { circumference } = ringGeometry(54, 3);
    assert.equal(dashOffset(100, circumference), 0);
    assert.equal(dashOffset(0, circumference), circumference);
  });

  it('never draws a low battery as an invisible sliver', () => {
    // 1% must read as "nearly flat", not as "no ring / no data".
    assert.ok(fillFraction(1) >= 0.04);
    assert.equal(fillFraction(50), 0.5);
  });

  it('clamps nonsense input', () => {
    assert.equal(fillFraction(140), 1);
    assert.equal(fillFraction(-5), 0);
  });
});

describe('battery tone', () => {
  it('uses the member accent when healthy', () => {
    assert.equal(batteryTone(unplugged(64)), 'accent');
  });

  it('warns at 20% and goes critical at 10%', () => {
    assert.equal(batteryTone(unplugged(20)), 'warning');
    assert.equal(batteryTone(unplugged(10)), 'critical');
  });

  it('treats a low phone on a charger as fine, not as an alarm', () => {
    assert.equal(batteryTone({ percent: 6, state: 'charging', powerSaving: false }), 'charging');
  });
});

describe('battery description (screen reader)', () => {
  it('says the number, not just the colour', () => {
    assert.equal(batteryDescription(unplugged(15)), 'battery 15 percent, low');
  });

  it('surfaces low power mode, the "slow replies" signal', () => {
    assert.equal(
      batteryDescription({ percent: 42, state: 'unplugged', powerSaving: true }),
      'battery 42 percent, low power mode on',
    );
  });

  it('does not call a charging phone low', () => {
    assert.equal(
      batteryDescription({ percent: 8, state: 'charging', powerSaving: false }),
      'battery 8 percent, charging',
    );
  });
});

describe('weather', () => {
  it('collapses WMO codes into a small glyph set', () => {
    assert.equal(weatherKind(0), 'clear');
    assert.equal(weatherKind(2), 'partly-cloudy');
    assert.equal(weatherKind(48), 'fog');
    assert.equal(weatherKind(55), 'drizzle');
    assert.equal(weatherKind(63), 'rain');
    assert.equal(weatherKind(81), 'rain');
    assert.equal(weatherKind(75), 'snow');
    assert.equal(weatherKind(99), 'storm');
  });

  it('falls back to a neutral glyph for unknown codes', () => {
    assert.equal(weatherKind(42), 'cloudy');
  });

  it('describes a clear night as a night', () => {
    assert.equal(
      weatherDescription({ code: 0, temperatureC: 18.6, isDay: false, observedAt: '' }),
      'clear night, 19 degrees',
    );
  });
});

describe('glyph motion policy', () => {
  it('loops only for the selected member', () => {
    assert.equal(
      glyphMotion({ selected: true, changedRecently: false, reduceMotion: false }),
      'loop',
    );
    assert.equal(
      glyphMotion({ selected: false, changedRecently: false, reduceMotion: false }),
      'still',
    );
  });

  it('plays once when the weather changes', () => {
    assert.equal(
      glyphMotion({ selected: false, changedRecently: true, reduceMotion: false }),
      'once',
    );
  });

  it('never moves under Reduce Motion, even when selected', () => {
    assert.equal(
      glyphMotion({ selected: true, changedRecently: true, reduceMotion: true }),
      'still',
    );
  });
});
