import { SIGN_IN_CODE_LENGTH } from '@haven/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { requestSignInCode, verifySignInCode } from '../../core/api/account';
import { useNow } from '../../lib/useNow';
import { Button } from '../../ui/primitives/Button';
import { HText } from '../../ui/primitives/HText';
import { TextField } from '../../ui/primitives/TextField';
import { OnboardingScreen } from './OnboardingScreen';
import { errorCopy } from './copy';

/** Long enough that a slow inbox gets a chance before a second email is sent. */
const RESEND_AFTER_MS = 30_000;

export const VerifyScreen = () => {
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const now = useNow(1_000);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState(() => Date.now());

  const resendIn = Math.max(0, Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000));

  const verify = async (value: string) => {
    if (value.length !== SIGN_IN_CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Success needs no navigation: the session flips to signed in and the
      // router's guards move on to the next stage.
      await verifySignInCode(email, value);
    } catch (caught) {
      setError(errorCopy(caught));
      setCode('');
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setNotice(null);
    try {
      await requestSignInCode(email);
      setSentAt(Date.now());
      setNotice('We sent you a new code.');
    } catch (caught) {
      setError(errorCopy(caught));
    }
  };

  return (
    <OnboardingScreen
      onBack={() => router.back()}
      title="Check your email"
      subtitle={`Enter the 6‑digit code we sent to ${email}.`}
      footer={
        <>
          <Button
            label="Continue"
            loading={busy}
            disabled={code.length !== SIGN_IN_CODE_LENGTH}
            onPress={() => void verify(code)}
          />
          <Button
            variant="quiet"
            label={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            disabled={resendIn > 0}
            onPress={() => void resend()}
          />
        </>
      }
    >
      <TextField
        code
        label="Code"
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, '').slice(0, SIGN_IN_CODE_LENGTH);
          setCode(digits);
          setError(null);
          // Submit as the last digit lands, including from the iOS
          // one-time-code autofill, which delivers all six at once.
          if (digits.length === SIGN_IN_CODE_LENGTH) void verify(digits);
        }}
        error={error}
        placeholder="••••••"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={SIGN_IN_CODE_LENGTH}
        editable={!busy}
        autoFocus
      />
      {notice ? (
        <HText variant="footnote" tone="mint" accessibilityLiveRegion="polite">
          {notice}
        </HText>
      ) : null}
    </OnboardingScreen>
  );
};
