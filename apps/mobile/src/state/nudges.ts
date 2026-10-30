import { create } from 'zustand';

import {
  applyDelivered,
  applyReceived,
  applySent,
  applyShown,
  emptyNudges,
  type NudgeState,
} from './nudgeReducer';

interface NudgeStore extends NudgeState {
  actions: {
    received: (event: Parameters<typeof applyReceived>[1]) => void;
    sent: (args: Parameters<typeof applySent>[1]) => void;
    delivered: (payload: Parameters<typeof applyDelivered>[1]) => void;
    shown: () => void;
    reset: () => void;
  };
}

/** Thin zustand wrapper over nudgeReducer, like the presence store. */
export const useNudges = create<NudgeStore>()((set) => ({
  ...emptyNudges,
  actions: {
    received: (event) => set((s) => applyReceived(s, event)),
    sent: (args) => set((s) => applySent(s, args)),
    delivered: (payload) => set((s) => applyDelivered(s, payload)),
    shown: () => set((s) => applyShown(s)),
    reset: () => set(emptyNudges),
  },
}));

export const nudgeActions = () => useNudges.getState().actions;
