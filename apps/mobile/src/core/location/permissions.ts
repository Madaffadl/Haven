import * as Location from 'expo-location';

/**
 * What the OS lets Haven do with location. Only 'always' lets the circle see
 * you while the app is closed, which is most of the time; 'when_in_use'
 * shares only while Haven is on screen.
 */
export type LocationAccess = 'undetermined' | 'denied' | 'when_in_use' | 'always';

export const readLocationAccess = async (): Promise<LocationAccess> => {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status === 'undetermined') return 'undetermined';
  if (!foreground.granted) return 'denied';
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'always' : 'when_in_use';
};

/**
 * Ask in two steps, the way iOS wants it: while-in-use first, then the
 * upgrade to Always. Asking for Always before while-in-use has been granted
 * is refused without a prompt.
 */
export const requestLocationAccess = async (): Promise<LocationAccess> => {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.granted ? 'always' : 'when_in_use';
};
