import type { TrustMode } from '@haven/contracts';
import { CircleDashed, EyeOff, MapPin, type LucideIcon } from 'lucide-react-native';

import { color } from '../../ui/theme/tokens';

/**
 * One icon and one accent per mode, shared by the chip, the option list and
 * the badge on your own avatar, so a mode looks the same everywhere it shows.
 * Mint is "precise location" and lavender is "privacy" (ui/theme/tokens.ts).
 */
export const MODE_VISUALS: Record<TrustMode, { icon: LucideIcon; tint: string }> = {
  precise: { icon: MapPin, tint: color.accent.mint },
  approximate: { icon: CircleDashed, tint: color.accent.lavender },
  ghost: { icon: EyeOff, tint: color.accent.lavender },
};
