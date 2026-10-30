import { create } from 'zustand';

import type { LocationAccess } from '../core/location/permissions';

interface LocationStore {
  /** null until the OS has been asked; drives the map banner and settings row. */
  access: LocationAccess | null;
  setAccess: (access: LocationAccess) => void;
}

export const useLocationAccess = create<LocationStore>()((set) => ({
  access: null,
  setAccess: (access) => set({ access }),
}));
