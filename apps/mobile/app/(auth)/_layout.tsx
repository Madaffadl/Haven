import { Stack } from 'expo-router';

import { color } from '../../src/ui/theme/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
