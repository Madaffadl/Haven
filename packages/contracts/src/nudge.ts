import { z } from 'zod';
import { circleId, isoInstant, nudgeId, userId } from './primitives';

/**
 * Tap-to-Nudge replaces chat. The vocabulary is deliberately tiny and
 * closed: a fixed set means every nudge has a known Lottie asset bundled
 * on-device (no network fetch on receive) and a known haptic pattern.
 */
export const nudgeKindSchema = z.enum([
  'heart',
  'wave',
  'thinking_of_you',
  'home_safe',
  'on_my_way',
  'where_are_you',
]);

export type NudgeKind = z.infer<typeof nudgeKindSchema>;

/**
 * Haptic signature per nudge, interpreted by the client. Kept in contracts
 * so the widget, the app and (later) the watch complication all buzz the
 * same way for the same nudge.
 */
export const NUDGE_HAPTICS: Record<NudgeKind, 'light' | 'medium' | 'success' | 'double'> = {
  heart: 'double',
  wave: 'light',
  thinking_of_you: 'light',
  home_safe: 'success',
  on_my_way: 'medium',
  where_are_you: 'medium',
};

export const sendNudgeSchema = z.object({
  circleId,
  /** Omit to nudge the whole circle; present to nudge one member. */
  toUserId: userId.optional(),
  kind: nudgeKindSchema,
  /**
   * Client-generated UUIDv7. Makes the send idempotent across socket
   * reconnects so a flaky tunnel never double-bursts a heart on screen.
   */
  clientNudgeId: nudgeId,
});

export type SendNudge = z.infer<typeof sendNudgeSchema>;

export const nudgeEventSchema = z.object({
  id: nudgeId,
  circleId,
  fromUserId: userId,
  toUserId: userId.optional(),
  kind: nudgeKindSchema,
  sentAt: isoInstant,
});

export type NudgeEvent = z.infer<typeof nudgeEventSchema>;

/**
 * Nudges are intentionally rate-limited. Without this, "one-tap affection"
 * degrades into a notification weapon — the exact anxiety the product is
 * meant to remove.
 */
export const NUDGE_RATE_LIMIT = {
  perRecipientPerMinute: 4,
  perSenderPerMinute: 12,
} as const;
