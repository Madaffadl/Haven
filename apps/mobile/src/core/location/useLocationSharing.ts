import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useLocationAccess } from '../../state/location';
import { readLocationAccess, requestLocationAccess, type LocationAccess } from './permissions';
import { startTracking, stopTracking } from './tracker';

const apply = async (access: LocationAccess): Promise<void> => {
  useLocationAccess.getState().setAccess(access);
  if (access === 'always' || access === 'when_in_use') await startTracking(access);
  else await stopTracking();
};

/**
 * Keeps tracking in step with what the OS allows, for as long as a signed-in
 * map is mounted. Access is re-read whenever the app comes back to the
 * front, because the usual way it changes is the user flipping it in the
 * system Settings app.
 *
 * Leaving the map does not stop tracking (sharing continues in the
 * background); signing out does (core/api/account.ts).
 */
export const useLocationSharing = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return undefined;

    let current: LocationAccess | null = null;
    const sync = async () => {
      const access = await readLocationAccess();
      if (access === current) return;
      current = access;
      await apply(access);
    };

    void sync().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [enabled]);
};

/** The "Turn on" button: ask the OS, then start with whatever was granted. */
export const turnOnLocation = async (): Promise<void> => {
  await apply(await requestLocationAccess());
};
