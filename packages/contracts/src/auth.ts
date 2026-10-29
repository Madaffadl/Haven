import { z } from 'zod';
import { isoInstant, userId } from './primitives';
import { trustModeSchema } from './trust';

/**
 * Passwordless email sign-in: request a code, then trade it for tokens.
 *
 * Email rather than SMS because it is free to deliver at MVP scale. The
 * schema keeps `users.phone_e164` for when phone sign-in is worth paying for.
 */

/**
 * Normalised before it is validated, so "Maya@Mail.com " and "maya@mail.com"
 * are one account. The column is citext as well; this keeps rate-limit and
 * code keys from splitting one address in two.
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const SIGN_IN_CODE_LENGTH = 6;

export const signInCodeSchema = z.string().regex(/^\d{6}$/);

export const startEmailSignInSchema = z.object({ email: emailSchema });

export type StartEmailSignIn = z.infer<typeof startEmailSignInSchema>;

export const devicePlatformSchema = z.enum(['ios', 'android']);

export const deviceInfoSchema = z.object({
  platform: devicePlatformSchema,
  osVersion: z.string().max(40).optional(),
  appVersion: z.string().max(40).optional(),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const verifyEmailSignInSchema = z.object({
  email: emailSchema,
  code: signInCodeSchema,
  device: deviceInfoSchema,
});

export type VerifyEmailSignIn = z.infer<typeof verifyEmailSignInSchema>;

export const tokenPairSchema = z.object({
  /** Short-lived; sent as `Authorization: Bearer` and in the socket handshake. */
  accessToken: z.string(),
  accessExpiresAt: isoInstant,
  /** Long-lived and single-use: every refresh returns a new one. */
  refreshToken: z.string(),
});

export type TokenPair = z.infer<typeof tokenPairSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(128) });

export const meSchema = z.object({
  userId,
  email: z.string().nullable(),
  displayName: z.string().min(1).max(40),
  avatarUrl: z.string().nullable(),
  accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /**
   * The user's own Trust Mode (`users.default_trust_mode`). It has to travel
   * here: presence can't carry it, because a member always sees themselves
   * as precise (`haven_circle_presence` projects the viewer's own row that
   * way), so the app could not otherwise tell what its user is sharing.
   */
  trustMode: trustModeSchema,
});

export type Me = z.infer<typeof meSchema>;

export const signInResultSchema = z.object({
  tokens: tokenPairSchema,
  me: meSchema,
  /** True on first sign-in: the display name is still a guess from the address. */
  isNewUser: z.boolean(),
});

export type SignInResult = z.infer<typeof signInResultSchema>;

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

export type UpdateMe = z.infer<typeof updateMeSchema>;
