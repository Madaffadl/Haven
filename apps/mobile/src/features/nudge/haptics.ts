import { NUDGE_HAPTICS, type NudgeKind } from '@haven/contracts';
import * as Haptics from 'expo-haptics';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The buzz for each nudge, from the shared table in contracts, so the app,
 * the widget and anything later all feel the same nudge the same way.
 * Best effort: a device without a Taptic Engine simply stays still.
 */
export const playNudgeHaptic = async (kind: NudgeKind): Promise<void> => {
  try {
    switch (NUDGE_HAPTICS[kind]) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case 'double':
        // A heartbeat: strong then soft, close together.
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await pause(110);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
    }
  } catch {
    // No haptics hardware, or the system has them turned off.
  }
};
