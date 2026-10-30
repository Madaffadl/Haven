import { Stack } from 'expo-router';

import { color } from '../../src/ui/theme/tokens';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="invite" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trust" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
      <Stack.Screen name="devices" options={{ presentation: 'modal' }} />
      <Stack.Screen name="new-circle" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
