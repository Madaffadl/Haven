import { create } from 'zustand';

import {
  applyBootstrap,
  applyLiveness,
  applyTrustChanged,
  applyUpdate,
  emptyPresence,
  type PresenceState,
} from './presenceReducer';

interface PresenceStore extends PresenceState {
  actions: {
    bootstrap: (payload: Parameters<typeof applyBootstrap>[1]) => void;
    update: (payload: Parameters<typeof applyUpdate>[1]) => void;
    liveness: (payload: Parameters<typeof applyLiveness>[1]) => void;
    trustChanged: (payload: Parameters<typeof applyTrustChanged>[1]) => void;
    reset: () => void;
  };
}

/**
 * Thin zustand wrapper over the pure reducers. Components subscribe with
 * narrow selectors (`usePresence((s) => s.circles[id]?.members[userId])`) so
 * one member's battery tick re-renders one avatar, not the whole map.
 */
export const usePresence = create<PresenceStore>()((set) => ({
  ...emptyPresence,
  actions: {
    bootstrap: (payload) => set((s) => applyBootstrap(s, payload)),
    update: (payload) => set((s) => applyUpdate(s, payload)),
    liveness: (payload) => set((s) => applyLiveness(s, payload)),
    trustChanged: (payload) => set((s) => applyTrustChanged(s, payload)),
    reset: () => set(emptyPresence),
  },
}));

export const presenceActions = () => usePresence.getState().actions;
