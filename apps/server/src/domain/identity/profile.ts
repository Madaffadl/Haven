import { randomInt } from 'node:crypto';
import { ACCENT_COLORS } from '@haven/contracts';

/**
 * Defaults for a brand-new account. The app asks for a real name right after
 * the first sign-in; these only have to be presentable for the moment until
 * it does, and for anyone who skips it.
 */

const FALLBACK_NAME = 'Haven member';

/** "maya.putri+haven@mail.com" → "Maya Putri". */
export const defaultDisplayName = (email: string): string => {
  const local = email.split('@')[0]?.split('+')[0] ?? '';

  const words = local
    .split(/[._-]+/)
    .map((word) => word.replace(/\d+/g, ''))
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());

  const name = words.join(' ').slice(0, 40).trim();
  return name.length > 0 ? name : FALLBACK_NAME;
};

/**
 * The accent a person carries into every circle: their Battery Ring and
 * avatar fill. Picked at signup (docs/01 §5) so they look the same
 * everywhere, and changeable later from the profile screen.
 */
export const pickAccent = (): string => ACCENT_COLORS[randomInt(ACCENT_COLORS.length)]!;

/**
 * What a deleted account's row becomes. The row itself stays, because
 * circles and nudges reference it, but nothing in it identifies the person
 * any more. Rewriting the email (rather than nulling it, which the
 * users_need_an_identifier CHECK forbids) frees the real address, so the
 * same person can sign up again later as someone new.
 */
export const DELETED_DISPLAY_NAME = 'Former member';

export const tombstoneEmail = (userId: string): string => `deleted+${userId}@deleted.invalid`;
