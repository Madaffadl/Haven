import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AA, composite, contrastRatio } from '../src/ui/theme/contrast.js';
import { color, mapBackdrop, palette } from '../src/ui/theme/tokens.js';

/**
 * Contrast is checked on the COMPOSED result: the glass fill flattened over
 * each extreme of the map, because that is what reaches the eye. The blur
 * underneath only averages the map, so the brightest map colour is a sound
 * worst case for what a blurred region can be.
 */

const glassOver = (backdrop: string) =>
  composite(color.glass.fillRgb, color.glass.fillAlpha, backdrop);

const surfaces = {
  'glass over darkest map': glassOver(mapBackdrop.darkest),
  'glass over brightest road': glassOver(mapBackdrop.brightest),
  'android fallback over brightest road': composite(
    color.glass.fillRgb,
    0.94,
    mapBackdrop.brightest,
  ),
};

const expectAtLeast = (fg: string, bg: string, min: number, label: string) => {
  const ratio = contrastRatio(fg, bg);
  assert.ok(ratio >= min, `${label}: ${ratio.toFixed(2)}:1, needs ${min}:1`);
};

describe('text on glass', () => {
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    it(`primary and secondary text pass 4.5:1 — ${surfaceName}`, () => {
      expectAtLeast(color.text.primary, surface, AA.normalText, 'primary');
      expectAtLeast(color.text.secondary, surface, AA.normalText, 'secondary');
    });

    it(`tertiary passes 4.5:1 inside glass — ${surfaceName}`, () => {
      expectAtLeast(color.text.tertiary, surface, AA.normalText, 'tertiary');
    });

    it(`all three accents are legible as text — ${surfaceName}`, () => {
      expectAtLeast(color.accent.peach, surface, AA.normalText, 'electric peach');
      expectAtLeast(color.accent.mint, surface, AA.normalText, 'neon mint');
      expectAtLeast(color.accent.lavender, surface, AA.normalText, 'soft lavender');
    });
  }
});

describe('labels drawn directly on the map', () => {
  it('tertiary fails on the bare map, which is why it is glass-backed only', () => {
    // If this ever starts passing, the "glass-backed only" rule in tokens.ts
    // is stale and should be relaxed deliberately rather than silently.
    const ratio = contrastRatio(color.text.tertiary, mapBackdrop.brightest);
    assert.ok(ratio < AA.normalText, `tertiary now ${ratio.toFixed(2)}:1 on bare map — revisit`);
  });

  it('primary and secondary stay legible even without glass', () => {
    expectAtLeast(color.text.primary, mapBackdrop.brightest, AA.normalText, 'primary on map');
    expectAtLeast(color.text.secondary, mapBackdrop.brightest, AA.normalText, 'secondary on map');
  });
});

describe('ink on pastel fills', () => {
  // Buttons and chips with a pastel background use dark ink, never white:
  // white on #7CF5C8 is ~1.3:1.
  for (const [name, fill] of Object.entries({
    peach: color.accent.peach,
    mint: color.accent.mint,
    lavender: color.accent.lavender,
    warning: color.status.warning,
    critical: color.status.critical,
  })) {
    it(`ink on ${name} passes 4.5:1`, () => {
      expectAtLeast(color.text.onAccent, fill, AA.normalText, `ink on ${name}`);
    });
  }

  it('white on a pastel would fail — the reason onAccent exists', () => {
    assert.ok(contrastRatio(palette.white, color.accent.mint) < AA.nonText);
  });
});

describe('map marks (non-text contrast, 3:1)', () => {
  // The Battery Ring arc and status colours are meaningful graphics, so they
  // must stand off the map itself — not just off the glass.
  for (const [name, mark] of Object.entries({
    'ring: mint': color.accent.mint,
    'ring: lavender': color.accent.lavender,
    'ring: peach': color.accent.peach,
    'ring: warning': color.status.warning,
    'ring: critical': color.status.critical,
  })) {
    it(`${name} stands off the brightest road`, () => {
      expectAtLeast(mark, mapBackdrop.brightest, AA.nonText, name);
    });
  }
});
