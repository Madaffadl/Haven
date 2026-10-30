import type { NudgeKind } from '@haven/contracts';

import { RealtimeRequestError } from '../../core/realtime/socket';

/**
 * The nudge vocabulary as people see it. Pure, and tested (test/nudge.test.ts).
 * The order follows the contract's enum: affection first, logistics last.
 */
export const NUDGES: readonly { kind: NudgeKind; emoji: string; label: string }[] = [
  { kind: 'heart', emoji: '❤️', label: 'a heart' },
  { kind: 'wave', emoji: '👋', label: 'a wave' },
  { kind: 'thinking_of_you', emoji: '💭', label: '“thinking of you”' },
  { kind: 'home_safe', emoji: '🏠', label: '“home safe”' },
  { kind: 'on_my_way', emoji: '🚶', label: '“on my way”' },
  { kind: 'where_are_you', emoji: '📍', label: '“where are you?”' },
];

const entry = (kind: NudgeKind) => NUDGES.find((n) => n.kind === kind) ?? NUDGES[0]!;

export const nudgeEmoji = (kind: NudgeKind): string => entry(kind).emoji;

export const sendLabel = (kind: NudgeKind, name: string): string =>
  `Send ${entry(kind).label} to ${name}`;

export const receivedCopy = (kind: NudgeKind, name: string): string =>
  `${name} sent you ${entry(kind).label}`;

export const seenCopy = (kind: NudgeKind, name: string): string => {
  const { label } = entry(kind);
  // "saw your a heart" → "saw your heart".
  return `${name} saw your ${label.replace(/^an? /, '')}`;
};

/**
 * The rate limit is a product feature (contracts NUDGE_RATE_LIMIT), so its
 * message is gentle. It also never says *whose* limit was hit; the server
 * deliberately makes the two indistinguishable.
 */
export const nudgeErrorCopy = (error: unknown): string => {
  const code = error instanceof RealtimeRequestError ? error.code : null;

  switch (code) {
    case 'rate_limited':
      return "That's a lot of nudges. Give it a minute.";
    case 'offline':
    case 'timeout':
      return "Couldn't send. Check your connection and try again.";
    default:
      return "Couldn't send that nudge. Try again.";
  }
};

/** Demo mode only: how the sample circle answers, so receiving can be seen too. */
export const DEMO_REPLY: Record<NudgeKind, NudgeKind> = {
  heart: 'heart',
  wave: 'wave',
  thinking_of_you: 'heart',
  home_safe: 'heart',
  on_my_way: 'wave',
  where_are_you: 'home_safe',
};
