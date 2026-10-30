import type { CircleKind, CircleSummary, DeviceSummary } from '@haven/contracts';

import type { LocationAccess } from '../../core/location/permissions';
import { relativeAge } from '../map/presenceCopy';

/**
 * Copy for the profile and settings screens. Pure, and tested
 * (test/settings.test.ts), because the leave and delete confirmations are
 * where wording has consequences.
 */

/** Spoken names for the accent swatches, in ACCENT_COLORS order. */
export const ACCENT_NAMES: Record<string, string> = {
  '#FFAD8F': 'Peach',
  '#7CF5C8': 'Mint',
  '#B9A7FF': 'Lavender',
  '#FFD27A': 'Sunflower',
  '#FFB4A2': 'Coral',
};

/** What location access means in practice, for the settings row. */
export const LOCATION_ACCESS_LABEL: Record<LocationAccess, string> = {
  always: 'Always',
  when_in_use: 'Only while open',
  denied: 'Off',
  undetermined: 'Not set',
};

export const KIND_LABEL: Record<CircleKind, string> = {
  couple: 'Couple',
  family: 'Family',
  friends: 'Friends',
};

export const circleMeta = (circle: CircleSummary): string =>
  `${KIND_LABEL[circle.kind]} · ${circle.memberCount} of ${circle.maxMembers}`;

/** "iOS 27.0 · Haven 1.0.0", with whatever the device reported. */
export const deviceDescription = (device: DeviceSummary): string =>
  [
    `${device.platform === 'ios' ? 'iOS' : 'Android'}${device.osVersion ? ` ${device.osVersion}` : ''}`,
    device.appVersion ? `Haven ${device.appVersion}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

export const deviceActivity = (device: DeviceSummary, now: number): string =>
  device.current
    ? 'This device'
    : `Active ${relativeAge(device.lastActiveAt ?? device.signedInAt, now)}`;

/**
 * Says what leaving actually does: sharing stops both ways, the way back is
 * an invite, and an owner's circle is not orphaned.
 */
export const leaveConfirmation = (circle: CircleSummary): { title: string; message: string } => {
  const lines = [
    "You'll stop sharing your location with this circle, and you'll stop seeing them.",
  ];
  if (circle.role === 'owner' && circle.memberCount > 1) {
    lines.push('The circle stays, and the next person in line becomes its owner.');
  }
  if (circle.memberCount <= 1) lines.push("You're the only one here, so the circle will close.");
  lines.push('You can come back with a new invite.');
  return { title: `Leave "${circle.name}"?`, message: lines.join(' ') };
};

export const DELETE_CONFIRMATION = {
  title: 'Delete your account?',
  message:
    "You'll be signed out on every device and removed from all your circles, and your location will be erased. This can't be undone.",
} as const;
