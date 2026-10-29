import { emailSchema } from '@haven/contracts';
import { useRouter } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { requestSignInCode } from '../../core/api/account';
import { useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { TextField } from '../../ui/primitives/TextField';
import { space } from '../../ui/theme/tokens';
import { HavenMark } from './HavenMark';
import { OnboardingScreen } from './OnboardingScreen';
import { errorCopy } from './copy';

export const SignInScreen = () => {
  const router = useRouter();
  const invited = useSession((s) => s.pendingInviteCode !== null);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = emailSchema.safeParse(email);

  const submit = async () => {
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestSignInCode(parsed.data);
      router.push({ pathname: '/verify', params: { email: parsed.data } });
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      hero={<HavenMark />}
      title="Welcome to Haven"
      subtitle="Sign in with your email. We'll send you a 6‑digit code, so there's no password to remember."
      footer={
        <Button
          label="Send code"
          icon={Mail}
          loading={busy}
          disabled={!parsed.success}
          onPress={() => void submit()}
        />
      }
    >
      {invited ? (
        <GlassPanel rounded="md" style={styles.note}>
          <HText variant="footnote" tone="secondary">
            You've been invited to a circle. Sign in and you'll join it next.
          </HText>
        </GlassPanel>
      ) : null}

      <TextField
        label="Email"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setError(null);
        }}
        error={error}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        autoFocus
      />
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  note: { padding: space.md },
});
