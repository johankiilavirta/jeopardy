import { Pressable, StyleSheet, Text } from 'react-native';
import { burnedValueOpacity, colors, radius, shadow, type as typeTokens } from '../theme/tokens';

interface BoardCellProps {
  value: number;
  /** Already-played clue: dead-navy fill, ghosted value, not pressable. */
  burned: boolean;
  /** Disables presses (e.g. when it is not the local player's turn). */
  disabled: boolean;
  onPress: () => void;
}

export function BoardCell({ value, burned, disabled, onPress }: BoardCellProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.cell,
        burned && styles.cellBurned,
        pressed && !burned && !disabled && styles.cellPressed,
      ]}
      onPress={onPress}
      disabled={burned || disabled}
    >
      <Text
        style={[styles.value, burned && styles.valueBurned]}
        numberOfLines={1}
        adjustsFontSizeToFit
        allowFontScaling={false}
      >
        ${value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellBurned: {
    backgroundColor: colors.cellBurned,
  },
  cellPressed: {
    backgroundColor: '#0029D6',
  },
  value: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.gold,
    letterSpacing: -0.5,
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  valueBurned: {
    opacity: burnedValueOpacity,
    textShadowColor: 'transparent',
  },
});
