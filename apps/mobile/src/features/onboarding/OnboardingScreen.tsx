import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, size, space } from '../../ui/theme/tokens';

interface OnboardingScreenProps {
  title: string;
  subtitle?: string;
  /** Above the title: the brand mark on the first screen, an avatar later on. */
  hero?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
  /** Pinned under the content and lifted with the keyboard. */
  footer?: ReactNode;
}

/**
 * The one layout every sign-in and onboarding screen shares: back button,
 * title, a short line of why, the fields, and the action at the bottom
 * where a thumb reaches it.
 */
export const OnboardingScreen = ({
  title,
  subtitle,
  hero,
  onBack,
  children,
  footer,
}: OnboardingScreenProps) => {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg },
        ]}
      >
        {onBack ? (
          <PressableScale accessibilityLabel="Back" onPress={onBack} style={styles.back}>
            <ArrowLeft size={size.icon.lg} color={color.text.primary} strokeWidth={2} />
          </PressableScale>
        ) : (
          <View style={styles.backSpacer} />
        )}

        {hero ? <View style={styles.hero}>{hero}</View> : null}

        <View style={styles.heading}>
          <HText variant="display" accessibilityRole="header">
            {title}
          </HText>
          {subtitle ? (
            <HText variant="body" tone="secondary">
              {subtitle}
            </HText>
          ) : null}
        </View>

        <View style={styles.body}>{children}</View>

        <View style={styles.grow} />

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { flexGrow: 1, paddingHorizontal: space.lg },
  back: { alignSelf: 'flex-start', justifyContent: 'center', marginLeft: -space.xs },
  backSpacer: { height: size.touchMin },
  hero: { marginTop: space.lg },
  heading: { gap: space.xs, marginTop: space.lg },
  body: { gap: space.md, marginTop: space.xl },
  grow: { flexGrow: 1, minHeight: space.xl },
  footer: { gap: space.xs },
});
