import { z } from 'zod';

/**
 * Branded IDs. Every ID in Haven is a UUIDv7 so that primary keys are
 * time-ordered — this keeps B-tree inserts sequential on the hot
 * `location_history` / `nudges` tables instead of scattering random pages.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type CircleId = Brand<string, 'CircleId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type NudgeId = Brand<string, 'NudgeId'>;
export type PlaceId = Brand<string, 'PlaceId'>;

/**
 * The schemas validate but do not brand.
 *
 * Branding the *wire* types would force a cast at every boundary where an ID
 * arrives as a plain string — every database row, every socket payload, every
 * route param — and a codebase full of `as UserId` casts has strictly less
 * type safety than one with none, because the casts are unchecked and become
 * reflexive. The brands above stay available for domain signatures that
 * genuinely benefit from them; the transport layer speaks strings.
 */
//
// `z.uuid()` is strict in zod 4: it enforces the RFC 9562 version and variant
// bits, unlike zod 3's loose hex pattern. That is what we want — every Haven
// ID is a well-formed UUIDv7 (`haven_uuidv7()` server-side, a v7 generator on
// the client), so a malformed id is a bug or an attack, never a legacy value.
// Use `z.guid()` if a permissive pattern is ever genuinely needed.
export const userId = z.uuid();
export const circleId = z.uuid();
export const deviceId = z.uuid();
export const nudgeId = z.uuid();

/** ISO-8601 instant, always UTC on the wire. */
export const isoInstant = z.iso.datetime({ offset: true });

/**
 * Wire format for a position. We send `[lon, lat]` to match GeoJSON and
 * Mapbox exactly, so no coordinate flipping happens between the DB and the
 * map camera — the single most common source of "why is everyone in the
 * ocean" bugs.
 */
export const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export type Coordinate = z.infer<typeof coordinateSchema>;

export const EARTH_RADIUS_M = 6_371_008.8;
