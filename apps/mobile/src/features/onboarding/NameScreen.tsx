import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { saveDisplayName } from '../../core/api/account';
import { useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { HText } from '../../ui/primitives/HText';
import { TextField } from '../../ui/primitives/TextField';
import { color, size } from '../../ui/theme/tokens';
import { initialsColor, initialsOf } from '../map/presenceCopy';
import { OnboardingScreen } from './OnboardingScreen';
import { errorCopy } from './copy';

/**
 * First sign-in only. The server guessed a name from the email address; this
 * is where the person replaces it with what their family actually calls them,
 * previewed on the avatar exactly as it will appear on everyone's map.
 */
export const NameScreen = () => {
  const me = useSession((s) => s.me);

  const [name, setName] = useState(me?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const accent = me?.accentHex ?? color.accent.peach;

  const submit = async () => {
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveDisplayName(trimmed);
    } catch (caught) {
      setError(errorCopy(caught));
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      hero={
        <View style={[styles.avatar, { backgroundColor: accent }]} accessible={false}>
          <HText variant="title" style={{ color: initialsColor(accent) }}>
            {initialsOf(trimmed || '?')}
          </HText>
        </View>
      }
      title="What should your circle call you?"
      subtitle="This is the name under your avatar on the map."
      footer={
        <Button
          label="Continue"
          loading={busy}
          disabled={trimmed.length === 0}
          onPress={() => void submit()}
        />
      }
    >
      <TextField
        label="Your name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        error={error}
        maxLength={40}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="givenName"
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        selectTextOnFocus
        autoFocus
      />
    </OnboardingScreen>
  );
};

const AVATAR = size.marker + 16;

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
