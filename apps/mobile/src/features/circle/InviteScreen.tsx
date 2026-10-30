import type { Invite } from '@haven/contracts';
import { useRouter } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet } from 'react-native';

import { createInvite } from '../../core/api/account';
import { selectActiveCircle, useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { color, space } from '../../ui/theme/tokens';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import {
  errorCopy,
  formatInviteCode,
  inviteMessage,
  inviteTerms,
  spokenInviteCode,
} from '../onboarding/copy';

/**
 * Make a code and hand it to the system share sheet: WhatsApp, iMessage,
 * whatever the family already uses. A fresh code each time the screen opens
 * is cheap and avoids sending someone a code that has quietly expired.
 */
export const InviteScreen = () => {
  const router = useRouter();
  const circle = useSession(selectActiveCircle);

  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!circle) return;
    setError(null);
    try {
      setInvite(await createInvite(circle.id));
    } catch (caught) {
      setError(errorCopy(caught));
    }
  }, [circle]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!circle) return null;

  const share = () => {
    if (!invite) return;
    void Share.share({
      message: inviteMessage({ code: invite.code, circleName: circle.name, kind: circle.kind }),
    });
  };

  return (
    <OnboardingScreen
      modal
      onBack={() => router.back()}
      title={circle.kind === 'couple' ? 'Invite your partner' : `Invite to ${circle.name}`}
      subtitle="Send them this code. When they open Haven and enter it, you'll see each other on the map."
      footer={
        <>
          {error ? (
            <Button variant="secondary" label="Try again" onPress={() => void load()} />
          ) : (
            <Button label="Share invite" icon={Share2} disabled={!invite} onPress={share} />
          )}
          <Button variant="quiet" label="Done" onPress={() => router.back()} />
        </>
      }
    >
      <GlassPanel style={styles.card}>
        {invite ? (
          <>
            <HText
              variant="display"
              tabular
              style={styles.code}
              accessibilityLabel={`Invite code ${spokenInviteCode(invite.code)}`}
              selectable
            >
              {formatInviteCode(invite.code)}
            </HText>
            <HText variant="footnote" tone="secondary">
              {inviteTerms(invite, Date.now())}
            </HText>
          </>
        ) : error ? (
          <HText variant="body" style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </HText>
        ) : (
          <ActivityIndicator color={color.text.secondary} />
        )}
      </GlassPanel>
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 132,
    padding: space.lg,
  },
  code: { letterSpacing: 4, color: color.accent.peach },
  error: { color: color.status.critical, textAlign: 'center' },
});
