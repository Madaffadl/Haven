import type { MemberPresence, MemberProfile } from '@haven/contracts';

import { contrastRatio } from '../../ui/theme/contrast';
import { palette } from '../../ui/theme/tokens';
import { batteryDescription } from './batteryModel';
import { weatherDescription } from './weatherModel';

/**
 * Every word the map says about a person, in one tested place.
 *
 * The accessibility label is the screen-reader equivalent of the whole avatar
 * composition — ring, glyph, badges, disc — so it has to carry everything a
 * sighted user gets at a glance, in the order that answers "are they okay?".
 */

/** Same threshold as the server's STALE_AFTER_MS. */
export const STALE_AFTER_MS = 20 * 60 * 1000;

export const isStale = (capturedAt: string | undefined, now: number): boolean =>
  capturedAt === undefined || now - Date.parse(capturedAt) > STALE_AFTER_MS;

export const nameOf = (profile: MemberProfile | undefined): string =>
  profile?.nickname ?? profile?.displayName ?? 'Someone';

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
};

/**
 * Initials colour against an arbitrary accent. Accents are user-chosen, so
 * ink vs. white is decided by measured contrast rather than assumed.
 */
export const initialsColor = (accentHex: string): string =>
  contrastRatio(palette.ink, accentHex) >= contrastRatio(palette.snow, accentHex)
    ? palette.ink
    : palette.snow;

export const relativeAge = (capturedAt: string | undefined, now: number): string => {
  if (capturedAt === undefined) return 'no location yet';
  const minutes = Math.max(0, Math.round((now - Date.parse(capturedAt)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};

/**
 * How the position should be described. The words must never claim more
 * precision than the server gave: an approximate member is "around here",
 * never "here".
 */
export const locationPhrase = (member: MemberPresence): string => {
  switch (member.trustMode) {
    case 'precise':
      return member.coordinate ? 'exact location' : 'location unavailable';
    case 'approximate':
      return member.coordinate
        ? `approximate area, within ${formatDistance(member.radiusM ?? 0)}`
        : 'approximate area, updating';
    case 'ghost':
      return 'location hidden';
  }
};

const formatDistance = (metres: number): string =>
  metres >= 1000
    ? `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km`
    : `${Math.round(metres)} m`;

/**
 * "11:40 PM" in the member's own zone, plus a day hint when their calendar
 * date differs from the viewer's. "It's 2:10 AM tomorrow there" answers
 * "why haven't they replied?" before anyone has to ask.
 */
export const localTime = (
  timezone: string | undefined,
  now: number,
  viewerTimezone: string,
  locale = 'en-US',
): { time: string; dayHint: 'tomorrow' | 'yesterday' | null } | null => {
  if (!timezone) return null;

  try {
    const time = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(now);

    const dayIn = (tz: string) =>
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: tz,
      }).format(now);

    const theirs = dayIn(timezone);
    const ours = dayIn(viewerTimezone);
    // en-CA formats as YYYY-MM-DD, so plain string comparison orders dates.
    const dayHint = theirs > ours ? 'tomorrow' : theirs < ours ? 'yesterday' : null;

    return { time, dayHint };
  } catch {
    // An unknown zone string from an old client must not crash the sheet.
    return null;
  }
};

export const markerAccessibilityLabel = (
  member: MemberPresence,
  profile: MemberProfile | undefined,
  now: number,
): string => {
  const parts = [nameOf(profile)];

  if (!member.online) parts.push('offline');
  parts.push(batteryDescription(member.battery));
  parts.push(weatherDescription(member.weather));
  parts.push(locationPhrase(member));
  if (isStale(member.capturedAt, now))
    parts.push(`last seen ${relativeAge(member.capturedAt, now)}`);

  return parts.join('. ');
};
