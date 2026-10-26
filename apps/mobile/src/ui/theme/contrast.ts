/**
 * WCAG 2.x contrast, including alpha compositing.
 *
 * Glass has no contrast ratio of its own — only "glass over this particular
 * pixel" does. `composite` flattens a translucent colour over a backdrop so
 * the ratio is computed on what the eye actually receives.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const parseHex = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`expected #rrggbb, got ${hex}`);
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Flatten `top` at `alpha` over an opaque `bottom`. */
export const composite = (top: string, alpha: number, bottom: string): string => {
  const t = parseHex(top);
  const b = parseHex(bottom);
  return toHex({
    r: t.r * alpha + b.r * (1 - alpha),
    g: t.g * alpha + b.g * (1 - alpha),
    b: t.b * alpha + b.b * (1 - alpha),
  });
};

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (hex: string): number => {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/** WCAG AA thresholds, named by what they apply to. */
export const AA = {
  normalText: 4.5,
  largeText: 3,
  nonText: 3,
} as const;
