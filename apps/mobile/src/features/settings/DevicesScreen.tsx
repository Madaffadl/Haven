import type { DeviceSummary } from '@haven/contracts';
import { useRouter } from 'expo-router';
import { Smartphone } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';

import { listDevices, revokeDevice } from '../../core/api/account';
import { useNow } from '../../lib/useNow';
import { Button } from '../../ui/primitives/Button';
import { HText } from '../../ui/primitives/HText';
import { color } from '../../ui/theme/tokens';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { errorCopy } from '../onboarding/copy';
import { SettingsRow, SettingsSection } from './SettingsList';
import { deviceActivity, deviceDescription } from './settingsCopy';

/**
 * Every device signed in to this account. Signing one out takes effect at
 * once: its sockets drop, and its session fails on the next request. This is
 * the answer to "I lost my phone", and to "someone else has my account".
 */
export const DevicesScreen = () => {
  const router = useRouter();
  const now = useNow();

  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDevices(await listDevices());
    } catch (caught) {
      setError(errorCopy(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmRevoke = (device: DeviceSummary) => {
    Alert.alert(
      'Sign out this device?',
      'It will need to sign in again before it can see your circles.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            setBusyId(device.deviceId);
            revokeDevice(device.deviceId)
              .then(load, (caught: unknown) => Alert.alert("That didn't work", errorCopy(caught)))
              .finally(() => setBusyId(null));
          },
        },
      ],
    );
  };

  return (
    <OnboardingScreen
      modal
      onBack={() => router.back()}
      title="Signed-in devices"
      subtitle="Sign out any device you don't recognise or no longer use."
      footer={
        error ? <Button variant="secondary" label="Try again" onPress={() => void load()} /> : null
      }
    >
      {devices ? (
        <SettingsSection title="Devices">
          {devices.map((device) => (
            <SettingsRow
              key={device.deviceId}
              icon={Smartphone}
              label={deviceDescription(device)}
              value={deviceActivity(device, now)}
              accessory={null}
              busy={busyId === device.deviceId}
              {...(device.current ? {} : { onPress: () => confirmRevoke(device) })}
            />
          ))}
        </SettingsSection>
      ) : error ? (
        <HText variant="body" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </HText>
      ) : (
        <ActivityIndicator color={color.text.secondary} />
      )}
    </OnboardingScreen>
  );
};

const styles = StyleSheet.create({
  error: { color: color.status.critical },
});
