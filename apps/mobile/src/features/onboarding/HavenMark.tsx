import { StyleSheet, View } from 'react-native';

import { color } from '../../ui/theme/tokens';

const DOT = 30;
const OVERLAP = 10;

/**
 * Three overlapping avatars in the brand accents: the circle, before anyone
 * is in it. Decorative, so it is hidden from screen readers.
 */
export const HavenMark = () => (
  <View
    style={styles.row}
    accessible={false}
    importantForAccessibility="no-hide-descendants"
    accessibilityElementsHidden
  >
    {[color.accent.peach, color.accent.mint, color.accent.lavender].map((fill, index) => (
      <View
        key={fill}
        style={[styles.dot, { backgroundColor: fill, marginLeft: index === 0 ? 0 : -OVERLAP }]}
      />
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    // A ring in the background colour separates the overlapping discs.
    borderWidth: 3,
    borderColor: color.background,
  },
});
