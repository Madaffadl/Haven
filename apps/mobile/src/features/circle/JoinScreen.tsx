import { inviteCodeSchema, type InvitePreview } from '@haven/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { acceptInvite, previewInvite } from '../../core/api/account';
import { selectStage, sessionActions, useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { color, size, space } from '../../ui/theme/tokens';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { errorCopy, joinSummary } from '../onboarding/copy';

/**
 * `haven://join/<code>`, from a shared link or the code field.
 *
 * Opened before there is an account, it parks the code and sends the person
 * to sign in; the circle screen picks it up afterwards. With an account, it
 * shows who is behind the invite and asks before joining. Joining shares a
 * live location, so it must never happen as a side effect of opening a link.
 */
export const JoinScreen = () => {
  const router = useRouter();
  const { code: raw = '' } = useLocalSearchParams<{ code: string }>();
  const stage = useSession(selectStage);

  const parsed = inviteCodeSchema.safeParse(raw);
  const code = parsed.success ? parsed.data : null;
  const canJoin = stage === 'circle' || stage === 'app';

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    if (stage === 'auth' || stage === 'name') {
      sessionActions().setPendingInvite(code);
      router.replace(stage === 'auth' ? '/sign-in' : '/name');
    }
  }, [code, stage, router]);

  useEffect(() => {
    if (!code || !canJoin) return;
    let cancelled = false;
    previewInvite(code).then(
      (result) => !cancelled && setPreview(result),
      (caught: unknown) => !cancelled && setError(errorCopy(caught)),
    );
    return () => {
      cancelled = true;
    };
  }, [code, canJoin]);

  const leave = () => {
    sessionActions().setPendingInvite(null);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const join = async () => {
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(code);
      // Back to the map whether this was opened from onboarding, a link, or
      // settings > another circle (where modals sit above the map).
      router.dismissTo('/');
    } catch (caught) {
      setError(errorCopy(caught));
      setBusy(false);
    }
  };

  const openExisting = () => {
    if (!preview) return;
    sessionActions().setActiveCircle(preview.circleId);
    sessionActions().setPendingInvite(null);
    router.dismissTo('/');
  };

  if (!code) {
    return (
      <OnboardingScreen
        onBack={leave}
        title="That code doesn't look right"
        subtitle="Invite codes are 6 letters and numbers, like K7M 2QX."
        footer={<Button variant="secondary" label="Back" onPress={leave} />}
      />
    );
  }

  if (!canJoin) return null; // redirecting to sign-in or the name step

  return (
    <OnboardingScreen
      onBack={leave}
      title={preview ? `Join ${preview.circleName}?` : 'Invite'}
      {...(preview && !preview.alreadyMember ? { subtitle: joinSummary(preview) } : {})}
      footer={
        preview?.alreadyMember ? (
          <Button label="Open map" onPress={openExisting} />
        ) : (
          <>
            <Button
              label="Join circle"
              loading={busy}
              disabled={!preview}
              onPress={() => void join()}
            />
            <Button variant="quiet" label="Not now" onPress={leave} />
          </>
        )
      }
    >
      <GlassPanel style={styles.card}>
        {preview ? (
          <View style={styles.row}>
            <Users size={size.icon.lg} color={color.accent.lavender} strokeWidth={2} />
            <View style={styles.text}>
              <HText variant="callout" numberOfLines={1}>
                {preview.circleName}
              </HText>
              <HText variant="footnote" tone="secondary" tabular>
                {preview.alreadyMember
                  ? "You're already in this circle."
                  : `${preview.memberCount} of ${preview.maxMembers} seats taken`}
              </HText>
            </View>
          </View>
        ) : error ? (
          <HText variant="body" style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </HText>
        ) : (
          <ActivityIndicator color={color.text.secondary} />
        )}
      </GlassPanel>
      {preview && error ? (
        <HText variant="footnote" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </HText>
      ) : null}
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  card: { minHeight: 88, padding: space.md, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1, gap: space.xxs },
  error: { color: color.status.critical },
});
