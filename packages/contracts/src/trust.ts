import { z } from 'zod';

/**
 * Trust Mode is the privacy contract between one member and one circle.
 * It is stored per (member, circle) pair — never globally — so that a user
 * can be Precise with their partner and Approximate with the family group
 * at the same moment.
 */
export const trustModeSchema = z.enum([
  /** Exact GPS, accuracy circle rendered as-is. */
  'precise',
  /** Snapped to a deterministic cell; only the cell centroid + radius leave the server. */
  'approximate',
  /** Nothing but liveness: "online, phone at 62%". No coordinate is broadcast. */
  'ghost',
]);

export type TrustMode = z.infer<typeof trustModeSchema>;

/**
 * Fuzz radii offered in the UI. These are *cell sizes*, not random jitter —
 * see `docs/privacy-model.md`. Random per-update jitter is averaged away by
 * an observer collecting samples; a stable cell cannot be.
 */
export const FUZZ_RADIUS_M = {
  neighbourhood: 1_000,
  district: 2_000,
  city: 5_000,
} as const;

export type FuzzRadiusKey = keyof typeof FUZZ_RADIUS_M;

export const trustSettingSchema = z.object({
  mode: trustModeSchema,
  /** Only meaningful when mode === 'approximate'. */
  fuzzRadiusM: z.number().int().min(250).max(25_000).default(FUZZ_RADIUS_M.neighbourhood),
});

export type TrustSetting = z.infer<typeof trustSettingSchema>;
