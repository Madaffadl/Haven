import { tokenPairSchema, type TokenPair } from '@haven/contracts';
import * as SecureStore from 'expo-secure-store';

import type { TokenStore } from '../api/createClient';

/**
 * Both tokens under one Keychain / Keystore entry, so a write can never leave
 * a new access token beside an old refresh token.
 *
 * AFTER_FIRST_UNLOCK so the background location task can authenticate while
 * the phone sits locked in a pocket, which is when it does most of its work.
 * THIS_DEVICE_ONLY so the session is not restored onto another phone from a
 * backup: a new device signs in and gets its own session.
 */
const KEY = 'haven.session';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureTokenStore: TokenStore = {
  async read() {
    const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
    if (!raw) return null;
    try {
      return tokenPairSchema.parse(JSON.parse(raw));
    } catch {
      // Unreadable means unusable; treat it as signed out rather than crash.
      return null;
    }
  },
  async write(tokens: TokenPair) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), OPTIONS);
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY, OPTIONS);
  },
};
