import type { CircleSummary, Me, TrustMode } from '@haven/contracts';

/**
 * Who is signed in and which circle is on screen, as pure transitions (the
 * same split as presenceReducer). The router derives everything from
 * `stageOf`, so "which screen should be showing" has exactly one answer.
 */

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn' | 'unreachable';

export interface SessionState {
  status: SessionStatus;
  me: Me | null;
  circles: CircleSummary[];
  activeCircleId: string | null;
  /** First sign-in: the name is still a guess from the email address. */
  needsName: boolean;
  /**
   * An invite opened before there was an account to accept it with. Kept
   * across sign-in so the invite link does what it promised afterwards.
   */
  pendingInviteCode: string | null;
  /**
   * What this user shares with their circles, as last confirmed by the
   * server. Presence cannot tell us: everyone sees themselves as precise.
   */
  trustMode: TrustMode;
}

export const initialSession: SessionState = {
  status: 'restoring',
  me: null,
  circles: [],
  activeCircleId: null,
  needsName: false,
  pendingInviteCode: null,
  trustMode: 'precise',
};

/** Keep the circle on screen if it still exists, else fall back to the first. */
const pickActive = (circles: CircleSummary[], current: string | null): string | null =>
  circles.some((c) => c.id === current) ? current : (circles[0]?.id ?? null);

export const applySignedIn = (
  state: SessionState,
  args: { me: Me; circles: CircleSummary[]; isNewUser: boolean },
): SessionState => ({
  ...state,
  status: 'signedIn',
  me: args.me,
  circles: args.circles,
  activeCircleId: pickActive(args.circles, state.activeCircleId),
  needsName: args.isNewUser,
  trustMode: args.me.trustMode,
});

export const applyMe = (state: SessionState, me: Me): SessionState => ({
  ...state,
  me,
  needsName: false,
  trustMode: me.trustMode,
});

/** Only after the server has acknowledged the change; see features/trust-mode. */
export const applyTrustMode = (state: SessionState, trustMode: TrustMode): SessionState => ({
  ...state,
  trustMode,
});

/** A circle the user just created or joined becomes the one on screen. */
export const applyCircleJoined = (state: SessionState, circle: CircleSummary): SessionState => ({
  ...state,
  circles: [...state.circles.filter((c) => c.id !== circle.id), circle],
  activeCircleId: circle.id,
  pendingInviteCode: null,
});

export const applySignedOut = (state: SessionState): SessionState => ({
  ...initialSession,
  status: 'signedOut',
  pendingInviteCode: state.pendingInviteCode,
});

export type Stage = 'restoring' | 'unreachable' | 'auth' | 'name' | 'circle' | 'app';

/**
 * Where each stage lives. Route guards redirect here when the current screen
 * stops being reachable, including at launch, when the initial URL is always
 * the map at "/".
 */
export const STAGE_HOME = {
  restoring: '/',
  unreachable: '/unreachable',
  auth: '/sign-in',
  name: '/name',
  circle: '/circle',
  app: '/',
} as const satisfies Record<Stage, string>;

export const stageOf = (state: SessionState): Stage => {
  if (state.status === 'restoring' || state.status === 'unreachable') return state.status;
  if (state.status === 'signedOut' || !state.me) return 'auth';
  if (state.needsName) return 'name';
  if (!state.activeCircleId) return 'circle';
  return 'app';
};
