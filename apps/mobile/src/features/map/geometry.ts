import type { Coordinate } from '@haven/contracts';
import { EARTH_RADIUS_M } from '@haven/contracts';

import { size } from '../../ui/theme/tokens';

/**
 * Map geometry. Pure, so the shapes the map draws are tested, not eyeballed.
 */

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export const distanceM = ([lon1, lat1]: Coordinate, [lon2, lat2]: Coordinate): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

/**
 * A true ground circle as a GeoJSON ring.
 *
 * Mapbox's CircleLayer sizes circles in screen pixels, so a "1 km" CircleLayer
 * is a different real size at every zoom level — and a fuzz disc that shrinks
 * as you zoom in would visually claim more precision than the server gave.
 * A polygon in real metres stays honest at every zoom.
 */
export const circlePolygon = (center: Coordinate, radiusM: number, steps = 64): Coordinate[] => {
  const [lon, lat] = center;
  const angular = radiusM / EARTH_RADIUS_M;
  const latR = toRad(lat);
  const lonR = toRad(lon);

  const ring: Coordinate[] = [];
  for (let i = 0; i < steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps;
    const pLat = Math.asin(
      Math.sin(latR) * Math.cos(angular) + Math.cos(latR) * Math.sin(angular) * Math.cos(bearing),
    );
    const pLon =
      lonR +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latR),
        Math.cos(angular) - Math.sin(latR) * Math.sin(pLat),
      );
    ring.push([toDeg(pLon), toDeg(pLat)]);
  }
  // GeoJSON rings are closed: last vertex repeats the first.
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
};

/** Precise accuracy rings tighter than this sit entirely under the avatar. */
export const MIN_VISIBLE_ACCURACY_M = 30;

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

export interface PixelOffset {
  dx: number;
  dy: number;
}

/**
 * Spread avatars that share a spot.
 *
 * A couple at home in Precise mode are at the same coordinate, so their
 * avatars stack and one of them vanishes — the map silently says "only one
 * of you is here". Members within `thresholdM` of each other are arranged on
 * a small circle instead. Ordering is by userId, so positions are stable
 * across updates and nobody swaps places as GPS jitters.
 *
 * The circle grows with the group so that neighbours on it stay
 * `clearancePx` apart, centre to centre: a whole marker plus room for the
 * weather and staleness badges that stick out past its edge. A fixed spread
 * let two avatars sit 40 px apart with 54 px rings, so one's weather badge
 * landed on the other.
 */
export const FAN_CLEARANCE_PX = size.marker + 12;

export interface FanGroup<M> {
  /** Where the group's marker is pinned: the first member's own position. */
  anchor: Coordinate;
  members: { member: M; offset: PixelOffset }[];
}

/**
 * The groups themselves, for rendering: the map draws one marker per group
 * with the avatars laid out inside it. Shifting separate markers by their
 * anchor only works within half a marker's width, and a group needs more.
 */
export const fanOutGroups = <M extends { userId: string; coordinate: Coordinate }>(
  members: readonly M[],
  thresholdM = 25,
  clearancePx = FAN_CLEARANCE_PX,
): FanGroup<M>[] => {
  const sorted = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
  const groups: M[][] = [];

  for (const member of sorted) {
    const group = groups.find((g) => {
      const anchor = g[0];
      return anchor !== undefined && distanceM(anchor.coordinate, member.coordinate) <= thresholdM;
    });
    if (group) group.push(member);
    else groups.push([member]);
  }

  return groups.map((group) => {
    if (group.length === 1) {
      return {
        anchor: group[0]!.coordinate,
        members: [{ member: group[0]!, offset: { dx: 0, dy: 0 } }],
      };
    }
    // Radius at which adjacent points on the circle are one clearance apart.
    const radius = clearancePx / (2 * Math.sin(Math.PI / group.length));
    return {
      anchor: group[0]!.coordinate,
      members: group.map((member, index) => {
        // Start at 12 o'clock and go clockwise.
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / group.length;
        return {
          member,
          offset: {
            dx: Math.round(Math.cos(angle) * radius),
            dy: Math.round(Math.sin(angle) * radius),
          },
        };
      }),
    };
  });
};

/** Each member's offset, by userId. */
export const fanOut = (
  members: readonly { userId: string; coordinate: Coordinate }[],
  thresholdM = 25,
  clearancePx = FAN_CLEARANCE_PX,
): Map<string, PixelOffset> =>
  new Map(
    fanOutGroups(members, thresholdM, clearancePx).flatMap((group) =>
      group.members.map(({ member, offset }) => [member.userId, offset] as const),
    ),
  );

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export interface Bounds {
  ne: Coordinate;
  sw: Coordinate;
}

/**
 * Bounding box for a set of points, padded so a lone member (or a couple at
 * one address) produces a sensible neighbourhood view instead of a
 * zero-area box the camera would zoom into indefinitely.
 */
export const boundsFor = (points: readonly Coordinate[], minSpanDeg = 0.01): Bounds | null => {
  if (points.length === 0) return null;

  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const padLon = Math.max(0, (minSpanDeg - (maxLon - minLon)) / 2);
  const padLat = Math.max(0, (minSpanDeg - (maxLat - minLat)) / 2);

  return {
    ne: [maxLon + padLon, maxLat + padLat],
    sw: [minLon - padLon, minLat - padLat],
  };
};
