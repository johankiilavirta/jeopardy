import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { burnedValueOpacity, colors, radius, shadow, type as typeTokens } from '../theme/tokens';

interface BoardCellProps {
  value: number;
  /** Already-played clue: dead-navy fill, ghosted value, not pressable. */
  burned: boolean;
  /** Disables presses (e.g. when it is not the local player's turn). */
  disabled: boolean;
  onPress: () => void;
  /** No clue exists for this position — renders an empty grid-colored slot. */
  empty?: boolean;
  /** Clue id stamped as data-clue-id for the board's contextmenu delegation. */
  clueId?: number;
}

export function BoardCell({ value, burned, disabled, onPress, empty, clueId }: BoardCellProps) {
  // On web, stamp the clue id via dataSet so RN Web renders it as data-clue-id
  // on the underlying div, letting the board's contextmenu handler find it.
  const dataProps = Platform.OS === 'web' && clueId != null && !burned && !empty
    ? ({ dataSet: { clueId: String(clueId) } } as object)
    : {};

  return (
    <View style={styles.cellWrap} {...dataProps}>
      <Pressable
        style={({ pressed }) => [
          styles.cell,
          empty && styles.cellEmpty,
          burned && !empty && styles.cellBurned,
          pressed && !burned && !disabled && !empty && styles.cellPressed,
        ]}
        onPress={onPress}
        disabled={burned || disabled || empty}
      >
        {!empty && (
          <Text
            style={[styles.value, burned && styles.valueBurned]}
            numberOfLines={1}
            adjustsFontSizeToFit
            allowFontScaling={false}
          >
            ${value}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cellWrap: {
    flex: 1,
  },
  cell: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellEmpty: {
    backgroundColor: '#1C1C1C',
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
