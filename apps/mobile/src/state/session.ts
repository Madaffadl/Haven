import { create } from 'zustand';

/**
 * Who is signed in and which circle is on screen.
 *
 * Authentication itself (phone OTP, token refresh) is not part of Phase 3;
 * this store is the seam it will fill. Until then the map screen runs in
 * demo mode or shows a signed-out state.
 */
export interface Session {
  userId: string;
  circleId: string;
}

interface SessionStore {
  session: Session | null;
  setSession: (session: Session | null) => void;
}

export const useSession = create<SessionStore>()((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
