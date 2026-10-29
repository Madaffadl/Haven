import { Stack } from 'expo-router';

import { selectStage, useSession } from '../../src/state/session';
import { STAGE_HOME } from '../../src/state/sessionReducer';
import { color } from '../../src/ui/theme/tokens';

/** Name first (new accounts only), then a circle. Each step guards itself. */
export default function OnboardingLayout() {
  const stage = useSession(selectStage);
  const home = STAGE_HOME[stage];

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Protected guard={stage === 'name'} redirectTo={home}>
        <Stack.Screen name="name" />
      </Stack.Protected>
      <Stack.Protected guard={stage === 'circle'} redirectTo={home}>
        <Stack.Screen name="circle" />
      </Stack.Protected>
    </Stack>
  );
}
