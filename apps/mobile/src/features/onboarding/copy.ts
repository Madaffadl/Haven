import type { CircleKind, Invite, InvitePreview } from '@haven/contracts';

import { ApiRequestError } from '../../core/api/createClient';

/**
 * Copy for sign-in, circles and invites. Pure, so it is tested (test/
 * onboarding.test.ts) rather than eyeballed. Calm by design: an error is
 * something to fix, never something to worry about.
 */

export const errorCopy = (error: unknown): string => {
  const code = error instanceof ApiRequestError ? error.code : null;

  switch (code) {
    case 'network':
      return "Can't reach Haven. Check your connection and try again.";
    case 'rate_limited': {
      const ms = error instanceof ApiRequestError ? error.retryAfterMs : undefined;
      const minutes = ms === undefined ? null : Math.max(1, Math.ceil(ms / 60_000));
      return minutes === null
        ? 'Too many tries. Wait a moment and try again.'
        : `Too many tries. Try again in ${minutes} min.`;
    }
    case 'invalid_code':
      return "That code isn't right. Check the email and try again.";
    case 'code_expired':
      return 'This code has expired. Send yourself a new one.';
    case 'invite_invalid':
      return "This invite isn't valid any more. Ask for a new code.";
    case 'circle_full':
      return 'This circle is already full.';
    case 'unauthenticated':
      return 'You were signed out. Sign in again.';
    case 'invalid_payload':
      return 'Something looks off. Check what you typed.';
    default:
      return 'Something went wrong. Try again.';
  }
};

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** "K7M2QX" → "K7M 2QX": two chunks of three are easier to read aloud. */
export const formatInviteCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/** For screen readers: letter by letter, not "kay-seven-mmm". */
export const spokenInviteCode = (code: string): string => code.split('').join(' ');

export const inviteLink = (code: string): string => `haven://join/${code}`;

export const inviteMessage = (args: { code: string; circleName: string; kind: CircleKind }) =>
  [
    args.kind === 'couple'
      ? 'Share your day with me on Haven 💛'
      : `Join "${args.circleName}" on Haven 💛`,
    `Code: ${args.code}`,
    inviteLink(args.code),
  ].join('\n');

const hoursLeft = (expiresAt: string, now: number): number =>
  Math.max(1, Math.round((Date.parse(expiresAt) - now) / 3_600_000));

export const inviteTerms = (invite: Invite, now: number): string => {
  const expiry = `expires in ${hoursLeft(invite.expiresAt, now)} h`;
  return invite.maxUses === 1
    ? `Works once · ${expiry}`
    : `Up to ${invite.maxUses} people · ${expiry}`;
};

/**
 * What joining means, said before the tap. Joining shares a live location,
 * so the person deciding must know exactly with whom.
 */
export const joinSummary = (preview: InvitePreview): string => {
  const what = 'your location, battery and local weather';
  return preview.memberCount === 1
    ? `${preview.inviterName} invited you. You'll share ${what} with them.`
    : `${preview.inviterName} invited you. You'll share ${what} with the ${preview.memberCount} people in this circle.`;
};

export const DEFAULT_CIRCLE_NAME: Record<CircleKind, string> = {
  couple: 'Us',
  family: 'Family',
  friends: 'Friends',
};
