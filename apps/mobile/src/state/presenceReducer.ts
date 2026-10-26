import type {
  MemberPresence,
  MemberProfile,
  PresenceBootstrap,
  PresenceUpdate,
  TrustMode,
} from '@haven/contracts';

/**
 * Client-side presence state, as pure functions.
 *
 * Kept free of React and zustand so the client half of the privacy contract
 * is unit-testable: the server decides what may be shown, but the client can
 * still leak by *keeping* something it was told to forget. Every rule below
 * exists to make sure a position, once withdrawn, is gone from memory.
 */

export interface CircleState {
  members: Record<string, MemberPresence>;
  /** Names, avatars, accents. Replaced on bootstrap; never touched by updates. */
  profiles: Record<string, MemberProfile>;
  /**
   * Members whose Trust Mode just changed and whose fresh bootstrap has not
   * arrived yet. While here, their position is unknown and updates for them
   * are dropped — see `applyUpdate`.
   */
  resolving: Record<string, true>;
}

export interface PresenceState {
  circles: Record<string, CircleState>;
}

export const emptyPresence: PresenceState = { circles: {} };

const emptyCircle: CircleState = { members: {}, profiles: {}, resolving: {} };

const withCircle = (
  state: PresenceState,
  circleId: string,
  next: (circle: CircleState) => CircleState,
): PresenceState => ({
  circles: { ...state.circles, [circleId]: next(state.circles[circleId] ?? emptyCircle) },
});

/** Full replacement. Members missing from the bootstrap are gone (left the circle). */
export const applyBootstrap = (state: PresenceState, payload: PresenceBootstrap): PresenceState =>
  withCircle(state, payload.circleId, () => ({
    members: Object.fromEntries(payload.members.map((m) => [m.userId, m])),
    profiles: Object.fromEntries(payload.profiles.map((p) => [p.userId, p])),
    resolving: {},
  }));

/**
 * One member changed.
 *
 * The incoming presence REPLACES the stored one; it is never merged. The
 * server sends a complete projection every time, and a field it omits is a
 * field the viewer is no longer allowed to have. Merging would keep the old
 * coordinate when someone switches to ghost — a spread operator would be the
 * leak.
 */
export const applyUpdate = (state: PresenceState, payload: PresenceUpdate): PresenceState => {
  const circle = state.circles[payload.circleId];
  const { userId } = payload.member;

  // A precise update that was in flight when the member went ghost must not
  // re-show them. Only the post-change bootstrap may clear this flag.
  if (circle?.resolving[userId]) return state;

  const previous = circle?.members[userId];
  if (
    previous?.capturedAt &&
    payload.member.capturedAt &&
    previous.trustMode === payload.member.trustMode &&
    payload.member.capturedAt < previous.capturedAt
  ) {
    // Out-of-order delivery: an older fix arriving after a newer one. ISO-8601
    // UTC strings compare correctly as strings.
    return state;
  }

  return withCircle(state, payload.circleId, (c) => ({
    ...c,
    members: { ...c.members, [userId]: payload.member },
  }));
};

/** Socket opened/closed. Touches `online` and nothing else. */
export const applyLiveness = (
  state: PresenceState,
  payload: { circleId: string; userId: string; online: boolean },
): PresenceState => {
  const member = state.circles[payload.circleId]?.members[payload.userId];
  if (!member) return state;

  return withCircle(state, payload.circleId, (c) => ({
    ...c,
    members: { ...c.members, [payload.userId]: { ...member, online: payload.online } },
  }));
};

/**
 * A member changed their privacy. Forget their position *now*, before the
 * fresh bootstrap arrives, and quarantine them until it does.
 *
 * This is the client contract from `ServerToClientEvents['trust:changed']`:
 * a position stays on screen for zero frames after its owner hides it.
 */
export const applyTrustChanged = (
  state: PresenceState,
  payload: { circleId: string; userId: string; mode: TrustMode },
): PresenceState => {
  const member = state.circles[payload.circleId]?.members[payload.userId];

  return withCircle(state, payload.circleId, (c) => {
    const members = { ...c.members };
    if (member) {
      // Rebuild without the positional fields rather than setting them to
      // undefined, so nothing that iterates keys can find a stale value.
      const { coordinate: _coordinate, radiusM: _radiusM, ...rest } = member;
      members[payload.userId] = { ...rest, trustMode: payload.mode };
    }
    return { ...c, members, resolving: { ...c.resolving, [payload.userId]: true } };
  });
};

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type MappableMember = MemberPresence & {
  coordinate: NonNullable<MemberPresence['coordinate']>;
};

/** Members with a position the map is allowed to draw. */
export const selectMappable = (state: PresenceState, circleId: string): MappableMember[] =>
  Object.values(state.circles[circleId]?.members ?? {}).filter(
    (m): m is MappableMember => m.coordinate !== undefined,
  );

/** Everyone, including hidden members — the sheet lists them all. */
export const selectAll = (state: PresenceState, circleId: string): MemberPresence[] =>
  Object.values(state.circles[circleId]?.members ?? {});

export const isResolving = (state: PresenceState, circleId: string, userId: string): boolean =>
  Boolean(state.circles[circleId]?.resolving[userId]);
