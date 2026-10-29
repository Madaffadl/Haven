import Constants from 'expo-constants';

import { sessionActions } from '../../state/session';
import { secureTokenStore } from '../storage/tokens';
import { createApiClient } from './createClient';

export const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? '';

export const api = createApiClient({
  baseUrl: API_URL,
  fetch: (input, init) => fetch(input, init),
  tokens: secureTokenStore,
  onSessionExpired: () => sessionActions().signedOut(),
});

export { ApiRequestError } from './createClient';
