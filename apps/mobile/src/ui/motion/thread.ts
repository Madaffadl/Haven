/**
 * The single UI-thread → JS-thread hop used by gesture code.
 *
 * Isolated here because it is the one animation API that differs between
 * Reanimated majors: v4 deprecates `runOnJS` in favour of `scheduleOnRN` from
 * react-native-worklets. Everything else in the app's motion code is the
 * same in v3 and v4. On a Reanimated 3 build, replace this file's body with:
 *
 *   import { runOnJS } from 'react-native-reanimated';
 *   export const toJS = <A extends unknown[]>(fn: (...args: A) => void, ...args: A) => {
 *     'worklet';
 *     runOnJS(fn)(...args);
 *   };
 */
export { scheduleOnRN as toJS } from 'react-native-worklets';
