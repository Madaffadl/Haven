import { z } from 'zod';
import { activitySchema, batteryContextSchema, weatherContextSchema } from './context';
import { coordinateSchema, isoInstant, userId } from './primitives';
import { trustModeSchema } from './trust';

/**
 * `MemberPresence` is the ONLY shape the server broadcasts to a circle, and
 * it is already privacy-projected: by the time it exists, Trust Mode has
 * been applied and a precise coordinate for an 'approximate' member is
 * simply not present in memory. Nothing downstream can leak what it never
 * received.
 */
export const memberPresenceSchema = z.object({
  userId,
  /** Which lens this viewer is seeing them through. Drives the map affordance. */
  trustMode: trustModeSchema,

  /**
   * Absent for 'ghost'. For 'approximate' this is the cell centroid, NOT the
   * member's real position — never label it as their location in the UI.
   */
  coordinate: coordinateSchema.optional(),

  /**
   * Radius in metres the UI must render around `coordinate`.
   * - precise: GPS accuracy (tight, usually 5-30m)
   * - approximate: the fuzz cell radius (1-5km)
   */
  radiusM: z.number().nonnegative().optional(),

  battery: batteryContextSchema.optional(),
  weather: weatherContextSchema.optional(),

  /** IANA zone, e.g. "Asia/Jakarta". Renders "11:40 PM there" with no math. */
  timezone: z.string().optional(),
  activity: activitySchema.default('unknown'),

  /** True while a socket is open. Distinct from "location is fresh". */
  online: z.boolean(),
  /** When this fix was taken on-device, not when the server received it. */
  capturedAt: isoInstant.optional(),
});

export type MemberPresence = z.infer<typeof memberPresenceSchema>;

/**
 * What a device pushes up. Note it always carries the *precise* fix: fuzzing
 * is a server-side projection, because a client that fuzzes locally can be
 * patched by its owner to lie, and we would lose the ability to let the user
 * see their own true trail.
 */
export const locationReportSchema = z.object({
  coordinate: coordinateSchema,
  accuracyM: z.number().nonnegative().max(10_000),
  altitudeM: z.number().optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  speedMps: z.number().nonnegative().optional(),
  activity: activitySchema.default('unknown'),
  battery: batteryContextSchema,
  timezone: z.string(),
  capturedAt: isoInstant,
});

export type LocationReport = z.infer<typeof locationReportSchema>;
