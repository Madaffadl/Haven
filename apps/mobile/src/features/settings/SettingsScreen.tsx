import { ACCENT_COLORS } from '@haven/contracts';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import {
  Heart,
  House,
  LogOut,
  Navigation,
  Plus,
  Shield,
  Smartphone,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { deleteAccount, leaveCircle, signOut, updateProfile } from '../../core/api/account';
import { turnOnLocation } from '../../core/location/useLocationSharing';
import { DEMO_CIRCLE_ID, DEMO_SELF_ID } from '../../dev/demoCircle';
import { DEMO_MODE } from '../../dev/demoMode';
import { useLocationAccess } from '../../state/location';
import { usePresence } from '../../state/presence';
import { selectActiveCircle, sessionActions, useSession } from '../../state/session';
import { Button } from '../../ui/primitives/Button';
import { GlassPanel } from '../../ui/primitives/GlassPanel';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { TextField } from '../../ui/primitives/TextField';
import { color, size, space } from '../../ui/theme/tokens';
import { initialsColor, initialsOf } from '../map/presenceCopy';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { errorCopy } from '../onboarding/copy';
import { trustLabel } from '../trust-mode/trustCopy';
import { SettingsRow, SettingsSection } from './SettingsList';
import {
  ACCENT_NAMES,
  DELETE_CONFIRMATION,
  LOCATION_ACCESS_LABEL,
  circleMeta,
  leaveConfirmation,
} from './settingsCopy';

const KIND_ICON: Record<string, LucideIcon> = { couple: Heart, family: House, friends: Users };

/**
 * You, your circles and your account, in one place.
 *
 * Notifications are not here yet: they arrive with push.
 *
 * In demo mode everything renders, so the layout can be seen, but anything
 * that needs an account is disabled. Trust Mode still works there.
 */
export const SettingsScreen = () => {
  const router = useRouter();
  const me = useSession((s) => s.me);
  const circles = useSession((s) => s.circles);
  const activeCircleId = useSession((s) => s.activeCircleId);
  const activeCircle = useSession(selectActiveCircle);
  const trustMode = useSession((s) => s.trustMode);
  const locationAccess = useLocationAccess((s) => s.access);
  const demoSelf = usePresence((s) => s.circles[DEMO_CIRCLE_ID]?.profiles[DEMO_SELF_ID]);

  const savedName = (DEMO_MODE ? demoSelf?.displayName : me?.displayName) ?? '';
  const accent = (DEMO_MODE ? demoSelf?.accentHex : me?.accentHex) ?? color.accent.peach;

  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const trimmed = name.trim();
  const nameChanged = trimmed.length > 0 && trimmed !== savedName;

  /** One action at a time; failures are reported where they happened. */
  const run = async (key: string, action: () => Promise<void>, onError?: (m: string) => void) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (caught) {
      const message = errorCopy(caught);
      if (onError) onError(message);
      else Alert.alert("That didn't work", message);
    } finally {
      setBusy(null);
    }
  };

  const confirmLeave = () => {
    if (!activeCircle) return;
    const { title, message } = leaveConfirmation(activeCircle);
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => void run('leave', () => leaveCircle(activeCircle.id)),
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(DELETE_CONFIRMATION.title, DELETE_CONFIRMATION.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: () => void run('delete', deleteAccount),
      },
    ]);
  };

  return (
    <OnboardingScreen
      modal
      onBack={() => router.back()}
      hero={
        <View style={[styles.avatar, { backgroundColor: accent }]} accessible={false}>
          <HText variant="title" style={{ color: initialsColor(accent) }}>
            {initialsOf(trimmed || savedName || '?')}
          </HText>
        </View>
      }
      title="Profile & settings"
      {...(me?.email ? { subtitle: me.email } : {})}
    >
      {DEMO_MODE ? (
        <GlassPanel rounded="md" style={styles.note}>
          <HText variant="footnote" tone="secondary">
            You're exploring the demo circle. Trust Mode works here; everything else needs a Haven
            account.
          </HText>
        </GlassPanel>
      ) : null}

      <View style={styles.profile}>
        <TextField
          label="Name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          error={nameError}
          maxLength={40}
          autoCapitalize="words"
          editable={!DEMO_MODE}
          returnKeyType="done"
        />
        {nameChanged ? (
          <Button
            variant="secondary"
            label="Save name"
            loading={busy === 'name'}
            onPress={() =>
              void run('name', () => updateProfile({ displayName: trimmed }), setNameError)
            }
          />
        ) : null}

        <HText variant="footnote" tone="secondary">
          Colour
        </HText>
        <View style={styles.swatches} accessibilityRole="radiogroup">
          {ACCENT_COLORS.map((hex) => {
            const selected = hex.toLowerCase() === accent.toLowerCase();
            return (
              <PressableScale
                key={hex}
                accessibilityRole="radio"
                accessibilityLabel={ACCENT_NAMES[hex] ?? 'Colour'}
                accessibilityState={{ selected }}
                disabled={DEMO_MODE || busy !== null}
                onPress={() => void run('accent', () => updateProfile({ accentHex: hex }))}
                style={[styles.swatchTouch, selected ? styles.swatchSelected : null]}
              >
                <View style={[styles.swatch, { backgroundColor: hex }]} />
              </PressableScale>
            );
          })}
        </View>
      </View>

      <SettingsSection title="Circles">
        {DEMO_MODE ? (
          <SettingsRow icon={House} label="Sample circle" value="Demo" accessory="check" />
        ) : (
          circles.map((circle) => (
            <SettingsRow
              key={circle.id}
              icon={KIND_ICON[circle.kind] ?? Users}
              label={circle.name}
              value={circleMeta(circle)}
              accessory={circle.id === activeCircleId ? 'check' : null}
              onPress={() => {
                sessionActions().setActiveCircle(circle.id);
                router.back();
              }}
            />
          ))
        )}
        <SettingsRow
          icon={UserPlus}
          label="Invite someone"
          disabled={DEMO_MODE}
          onPress={() => router.push('/invite')}
        />
        <SettingsRow
          icon={Plus}
          label="Start or join another circle"
          disabled={DEMO_MODE}
          onPress={() => router.push('/new-circle')}
        />
        <SettingsRow
          icon={UserMinus}
          label={activeCircle ? `Leave ${activeCircle.name}` : 'Leave circle'}
          destructive
          accessory={null}
          disabled={DEMO_MODE || !activeCircle}
          busy={busy === 'leave'}
          onPress={confirmLeave}
        />
      </SettingsSection>

      <SettingsSection title="Privacy">
        <SettingsRow
          icon={Navigation}
          label="Location access"
          value={LOCATION_ACCESS_LABEL[locationAccess ?? 'undetermined']}
          onPress={() =>
            locationAccess === 'undetermined' && !DEMO_MODE
              ? void turnOnLocation()
              : void Linking.openSettings()
          }
        />
        <SettingsRow
          icon={Shield}
          label="Trust Mode"
          value={trustLabel(trustMode)}
          onPress={() => router.push('/trust')}
        />
      </SettingsSection>

      <SettingsSection title="Security">
        <SettingsRow
          icon={Smartphone}
          label="Signed-in devices"
          disabled={DEMO_MODE}
          onPress={() => router.push('/devices')}
        />
      </SettingsSection>

      <SettingsSection title="Account">
        <SettingsRow
          icon={LogOut}
          label="Sign out"
          accessory={null}
          disabled={DEMO_MODE}
          busy={busy === 'signOut'}
          onPress={() => void run('signOut', signOut)}
        />
        <SettingsRow
          icon={Trash2}
          label="Delete account"
          destructive
          accessory={null}
          disabled={DEMO_MODE}
          busy={busy === 'delete'}
          onPress={confirmDelete}
        />
      </SettingsSection>

      <HText variant="footnote" tone="tertiary" style={styles.version}>
        {`Haven ${Constants.expoConfig?.version ?? ''}`}
      </HText>
    </OnboardingScreen>
  );
};

const AVATAR = size.marker + 16;
const SWATCH = 32;

const styles = StyleSheet.create({
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { padding: space.md },
  profile: { gap: space.sm },
  swatches: { flexDirection: 'row', gap: space.sm },
  swatchTouch: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: size.touchMin / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: color.text.primary },
  swatch: { width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2 },
  version: { textAlign: 'center', marginTop: space.sm },
});
