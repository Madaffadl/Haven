import { FUZZ_RADIUS_M, type TrustMode } from '@haven/contracts';

import { RealtimeRequestError } from '../../core/realtime/socket';

/**
 * Trust Mode copy. Pure, and tested (test/trust.test.ts): privacy wording is
 * a promise to the user, so it should not drift from what the server does.
 *
 * Each option says what the *circle* sees, not what the setting is called.
 * That is the decision being made.
 */

/**
 * The toggle sets the global default, which the server applies with the
 * neighbourhood radius. The disc it draws has that radius; the snapping cell
 * behind it is about twice as wide (domain/location/fuzz.ts, cellSizeM).
 */
const AREA_KM = (FUZZ_RADIUS_M.neighbourhood * 2) / 1000;

export interface TrustOption {
  mode: TrustMode;
  label: string;
  summary: string;
}

export const TRUST_OPTIONS: readonly TrustOption[] = [
  {
    mode: 'precise',
    label: 'Precise',
    summary: 'Your circle sees exactly where you are, as you move.',
  },
  {
    mode: 'approximate',
    label: 'Approximate',
    summary: `Your circle sees only the area you're in, about ${AREA_KM} km wide. Never your exact spot.`,
  },
  {
    mode: 'ghost',
    label: 'Hidden',
    summary:
      "No location at all. Your circle still sees your battery and weather, so they know you're okay.",
  },
];

export const trustLabel = (mode: TrustMode): string =>
  TRUST_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;

/** Spoken on your own marker, which always shows your exact spot to you. */
export const selfPrivacyPhrase = (mode: TrustMode): string | null => {
  switch (mode) {
    case 'approximate':
      return 'Your circle sees only your approximate area';
    case 'ghost':
      return 'Hidden from your circle';
    default:
      return null;
  }
};

/**
 * Every failure says plainly that nothing changed. The worst outcome here is
 * not the error itself but someone believing they are hidden when they are not.
 */
export const trustErrorCopy = (error: unknown): string => {
  const code = error instanceof RealtimeRequestError ? error.code : null;

  switch (code) {
    case 'offline':
    case 'timeout':
      return "Couldn't reach Haven, so nothing changed. Check your connection and try again.";
    case 'rate_limited':
      return 'Too many changes in a row, so nothing changed. Wait a moment and try again.';
    default:
      return "Couldn't change Trust Mode, so nothing changed. Try again.";
  }
};
