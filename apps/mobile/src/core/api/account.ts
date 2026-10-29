import {
  acceptInviteResultSchema,
  circleListSchema,
  circleSummarySchema,
  invitePreviewSchema,
  inviteSchema,
  meSchema,
  routes,
  signInResultSchema,
  type CircleKind,
  type DeviceInfo,
} from '@haven/contracts';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { presenceActions } from '../../state/presence';
import { sessionActions } from '../../state/session';
import { disconnectRealtime } from '../realtime/socket';
import { secureTokenStore } from '../storage/tokens';
import { ApiRequestError, api } from './index';

/**
 * Account and circle flows: each is one or two REST calls plus the session
 * state change that follows. Screens call these and render errors; they do
 * not touch the API client or the store directly.
 */

const device = (): DeviceInfo => ({
  platform: Platform.OS === 'android' ? 'android' : 'ios',
  osVersion: String(Platform.Version),
  ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
});

/**
 * At launch: no stored tokens means signed out without a network call. With
 * tokens, the session is only trusted once the server has confirmed it.
 * An unreachable server is its own state, not a sign-out, so a phone that
 * launches offline keeps its session.
 */
export const restoreSession = async (): Promise<void> => {
  const actions = sessionActions();

  // A Keychain that cannot be read counts as signed out. Throwing here would
  // leave the splash screen up forever, since it waits for this to settle.
  const stored = await secureTokenStore.read().catch(() => null);
  if (!stored) {
    actions.signedOut();
    return;
  }

  try {
    const [me, circles] = await Promise.all([
      api.request(routes.me, {}, meSchema),
      api.request(routes.circles, {}, circleListSchema),
    ]);
    actions.signedIn({ me, circles, isNewUser: false });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return; // already signed out
    actions.unreachable();
  }
};

export const requestSignInCode = (email: string): Promise<void> =>
  api.request(routes.emailStart, { method: 'POST', body: { email }, auth: false });

export const verifySignInCode = async (email: string, code: string): Promise<void> => {
  const result = await api.request(
    routes.emailVerify,
    { method: 'POST', body: { email, code, device: device() }, auth: false },
    signInResultSchema,
  );
  await secureTokenStore.write(result.tokens);

  const circles = await api.request(routes.circles, {}, circleListSchema);
  sessionActions().signedIn({ me: result.me, circles, isNewUser: result.isNewUser });
};

export const saveDisplayName = async (displayName: string): Promise<void> => {
  const me = await api.request(routes.me, { method: 'PATCH', body: { displayName } }, meSchema);
  sessionActions().me(me);
};

export const createCircle = async (name: string, kind: CircleKind): Promise<void> => {
  const circle = await api.request(
    routes.circles,
    { method: 'POST', body: { name, kind } },
    circleSummarySchema,
  );
  sessionActions().circleJoined(circle);
};

export const createInvite = (circleId: string) =>
  api.request(routes.circleInvites(circleId), { method: 'POST' }, inviteSchema);

/** `code` must already have been through inviteCodeSchema. */
export const previewInvite = (code: string) =>
  api.request(routes.invite(code), {}, invitePreviewSchema);

export const acceptInvite = async (code: string): Promise<void> => {
  const { circle } = await api.request(
    routes.acceptInvite(code),
    { method: 'POST' },
    acceptInviteResultSchema,
  );
  sessionActions().circleJoined(circle);
};

/**
 * Local sign-out always completes. Telling the server is best effort: a
 * phone with no signal must still be able to sign out, and the session it
 * leaves behind expires on its own.
 */
export const signOut = async (): Promise<void> => {
  disconnectRealtime();
  await api.request(routes.signOut, { method: 'POST' }).catch(() => undefined);
  await secureTokenStore.clear();
  presenceActions().reset();
  sessionActions().signedOut();
};
