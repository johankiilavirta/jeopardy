import { useEffect, useRef } from 'react';
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
  /** Web: right-click (contextmenu) burns this clue without playing it. */
  onSkip?: (() => void) | undefined;
}

export function BoardCell({ value, burned, disabled, onPress, empty, onSkip }: BoardCellProps) {
  const wrapRef = useRef<View>(null);

  // Web only: attach a native contextmenu (right-click) listener directly to
  // this cell's DOM node. The handler closes over onSkip, so there's no need
  // to stamp/parse any id — right-clicking the cell burns exactly this clue.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onSkip || burned || empty) return;
    const node = wrapRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const handler = (e: Event) => {
      e.preventDefault();
      onSkip();
    };
    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
  }, [onSkip, burned, empty]);

  return (
    <View ref={wrapRef} style={styles.cellWrap}>
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
