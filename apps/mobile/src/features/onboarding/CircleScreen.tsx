import { inviteCodeSchema, type CircleKind } from '@haven/contracts';
import { useRouter } from 'expo-router';
import { Heart, House, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { createCircle } from '../../core/api/account';
import { useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { TextField } from '../../ui/primitives/TextField';
import { color, radius, size, space } from '../../ui/theme/tokens';
import { OnboardingScreen } from './OnboardingScreen';
import { DEFAULT_CIRCLE_NAME, errorCopy } from './copy';

/**
 * Haven is for couples and families, so those are the two ways to start.
 * (The backend also knows 'friends'; it is not offered here on purpose.)
 */
const KINDS: { kind: CircleKind; label: string; icon: LucideIcon }[] = [
  { kind: 'couple', label: 'Couple', icon: Heart },
  { kind: 'family', label: 'Family', icon: House },
];

interface CircleScreenProps {
  /**
   * onboarding: the first circle; success moves the router on by itself.
   * add: another circle from settings; it has a way back and closes itself.
   */
  mode?: 'onboarding' | 'add';
}

export const CircleScreen = ({ mode = 'onboarding' }: CircleScreenProps) => {
  const router = useRouter();
  const pendingCode = useSession((s) => s.pendingInviteCode);

  const [kind, setKind] = useState<CircleKind>('couple');
  const [name, setName] = useState(DEFAULT_CIRCLE_NAME.couple);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [code, setCode] = useState(pendingCode ?? '');
  const parsedCode = inviteCodeSchema.safeParse(code);

  // Arrived through an invite link before having an account: now that there
  // is one, carry on to the invite they opened. "Not now" there clears it.
  useEffect(() => {
    if (pendingCode) router.push(`/join/${pendingCode}`);
  }, [pendingCode, router]);

  const chooseKind = (next: CircleKind) => {
    // Swap the suggested name along with the kind, unless they typed their own.
    if (name === DEFAULT_CIRCLE_NAME[kind]) setName(DEFAULT_CIRCLE_NAME[next]);
    setKind(next);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      // During onboarding the new circle moves the router to the map by
      // itself; from settings, this screen closes.
      await createCircle(trimmed, kind);
      if (mode === 'add') router.back();
    } catch (caught) {
      setError(errorCopy(caught));
      setBusy(false);
    }
  };

  const join = () => {
    if (parsedCode.success) router.push(`/join/${parsedCode.data}`);
  };

  return (
    <OnboardingScreen
      {...(mode === 'add' ? { onBack: () => router.back(), modal: true } : {})}
      title={mode === 'add' ? 'Another circle' : 'Start your circle'}
      subtitle="A circle is the few people you share your day with. Only they can see you."
      footer={
        <Button
          label="Create circle"
          loading={busy}
          disabled={name.trim().length === 0}
          onPress={() => void create()}
        />
      }
    >
      <View style={styles.kinds} accessibilityRole="radiogroup">
        {KINDS.map(({ kind: option, label, icon: Icon }) => {
          const selected = option === kind;
          return (
            <PressableScale
              key={option}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => chooseKind(option)}
              style={[styles.kind, selected ? styles.kindSelected : null]}
            >
              <Icon
                size={size.icon.lg}
                color={selected ? color.accent.peach : color.text.secondary}
                strokeWidth={2}
              />
              <HText variant="callout" tone={selected ? 'primary' : 'secondary'}>
                {label}
              </HText>
            </PressableScale>
          );
        })}
      </View>

      <TextField
        label="Circle name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        error={error}
        maxLength={40}
        autoCapitalize="words"
        returnKeyType="done"
      />

      <View style={styles.divider}>
        <View style={styles.rule} />
        <HText variant="footnote" tone="tertiary">
          or
        </HText>
        <View style={styles.rule} />
      </View>

      <TextField
        label="Have an invite code?"
        value={code}
        onChangeText={setCode}
        placeholder="K7M 2QX"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        returnKeyType="go"
        onSubmitEditing={join}
      />
      <Button
        variant="secondary"
        label="Join with code"
        disabled={!parsedCode.success}
        onPress={join}
      />
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: space.sm },
  kind: {
    flex: 1,
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.glass.border,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  kindSelected: {
    borderColor: color.accent.peach,
    backgroundColor: 'rgba(255, 173, 143, 0.10)',
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.xs },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.glass.border },
});
