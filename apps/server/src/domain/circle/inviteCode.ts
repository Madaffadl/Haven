import { randomInt } from 'node:crypto';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@haven/contracts';

/**
 * 32^6 ≈ 1.07 billion codes. Live invites number in the thousands at most,
 * so a collision with the unique index is rare enough that the insert simply
 * retries with a fresh code.
 *
 * `randomInt` rather than `Math.random`: an invite code is a bearer
 * credential for someone's location, and must not be predictable from the
 * ones before it.
 */
export const generateInviteCode = (): string => {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
};

/** Hard ceiling from the `circle_invites.max_uses` CHECK. */
const MAX_USES_CEILING = 20;

/**
 * One invite fills every open seat by default: a parent can drop a single
 * code into the family group chat. A couple has one open seat, so their
 * invite is single-use without anyone having to choose.
 */
export const defaultInviteUses = (memberCount: number, maxMembers: number): number =>
  Math.min(MAX_USES_CEILING, Math.max(1, maxMembers - memberCount));
