import { CloudOff } from 'lucide-react-native';
import { useState } from 'react';

import { restoreSession, signOut } from '../../core/api/account';
import { Button } from '../../ui/primitives/Button';
import { color, size } from '../../ui/theme/tokens';
import { OnboardingScreen } from './OnboardingScreen';

/**
 * Signed in, but the server could not confirm it at launch. Not a sign-out:
 * the session is kept, and "Try again" is the expected way out.
 */
export const UnreachableScreen = () => {
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    await restoreSession();
    setBusy(false);
  };

  return (
    <OnboardingScreen
      hero={<CloudOff size={size.icon.lg * 2} color={color.text.secondary} strokeWidth={1.5} />}
      title="Can't reach Haven"
      subtitle="Check your connection. Your circle will be right here when you're back online."
      footer={
        <>
          <Button label="Try again" loading={busy} onPress={() => void retry()} />
          <Button variant="quiet" label="Sign out" onPress={() => void signOut()} />
        </>
      }
    />
  );
};
