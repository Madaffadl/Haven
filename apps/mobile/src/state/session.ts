import type { CircleSummary, Me, TrustMode } from '@haven/contracts';
import { create } from 'zustand';

import {
  applyCircleJoined,
  applyCircleLeft,
  applyMe,
  applySignedIn,
  applySignedOut,
  applyTrustMode,
  initialSession,
  stageOf,
  type SessionState,
} from './sessionReducer';

interface SessionStore extends SessionState {
  actions: {
    unreachable: () => void;
    signedIn: (args: Parameters<typeof applySignedIn>[1]) => void;
    signedOut: () => void;
    me: (me: Me) => void;
    circleJoined: (circle: CircleSummary) => void;
    circleLeft: (circleId: string) => void;
    setActiveCircle: (circleId: string) => void;
    setPendingInvite: (code: string | null) => void;
    trustModeConfirmed: (mode: TrustMode) => void;
  };
}

/**
 * Thin zustand wrapper over sessionReducer. Network calls that drive it live
 * in core/api/account.ts; this file only holds state.
 */
export const useSession = create<SessionStore>()((set) => ({
  ...initialSession,
  actions: {
    unreachable: () => set({ status: 'unreachable' }),
    signedIn: (args) => set((s) => applySignedIn(s, args)),
    signedOut: () => set((s) => applySignedOut(s)),
    me: (me) => set((s) => applyMe(s, me)),
    circleJoined: (circle) => set((s) => applyCircleJoined(s, circle)),
    circleLeft: (circleId) => set((s) => applyCircleLeft(s, circleId)),
    setActiveCircle: (activeCircleId) => set({ activeCircleId }),
    setPendingInvite: (pendingInviteCode) => set({ pendingInviteCode }),
    trustModeConfirmed: (mode) => set((s) => applyTrustMode(s, mode)),
  },
}));

export const sessionActions = () => useSession.getState().actions;

export const selectStage = (state: SessionState) => stageOf(state);

export const selectActiveCircle = (state: SessionState): CircleSummary | undefined =>
  state.circles.find((c) => c.id === state.activeCircleId);
