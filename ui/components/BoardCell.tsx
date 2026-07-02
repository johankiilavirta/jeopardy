import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { burnedValueOpacity, colors, radius, shadow, type as typeTokens } from '../theme/tokens';

/** Gap between the "$" and the digits, as a fraction of the value font size. */
const DOLLAR_GAP = 0.06;

/** A cell's on-screen rectangle in window coords (for the expand animation). */
export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardCellProps {
  value: number;
  /** Uniform value font size for the whole board (so every value matches). When
   *  omitted (pre-measure), the value falls back to self-fitting. */
  valueFontSize?: number | undefined;
  /** Already-played clue: dead-navy fill, ghosted value, not pressable. */
  burned: boolean;
  /** Disables presses (e.g. when it is not the local player's turn). */
  disabled: boolean;
  /** Receives this cell's window rect so the clue can expand out of it. */
  onPress: (rect: CellRect) => void;
  /** No clue exists for this position — renders like a played/dead cell rather
   *  than a distracting gray slot. */
  empty?: boolean;
  /** Web: right-click (contextmenu) burns this clue without playing it. */
  onSkip?: (() => void) | undefined;
}

export function BoardCell({ value, valueFontSize, burned, disabled, onPress, empty, onSkip }: BoardCellProps) {
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

  // Measure this cell's window rect at press time so the clue card can grow
  // out of exactly where it sits on the grid. measureInWindow is async; if it
  // isn't available (or returns nothing), fall back to a zero rect, which the
  // overlay treats as "no animation".
  const handlePress = () => {
    const node = wrapRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
    } else {
      onPress({ x: 0, y: 0, width: 0, height: 0 });
    }
  };

  // A missing clue is dead in exactly the same way as a burned one: dead-navy
  // fill, ghosted value, not pressable. Only the reason differs (no content
  // vs. already played), so they share the burned styling and keep the value.
  const dead = burned || empty;

  return (
    <View ref={wrapRef} style={styles.cellWrap}>
      <Pressable
        style={({ pressed }) => [
          styles.cell,
          dead && styles.cellBurned,
          pressed && !dead && !disabled && styles.cellPressed,
        ]}
        onPress={handlePress}
        disabled={dead || disabled}
      >
        {/* The "$" is its own element so we can give it the broadcast spacing
            (a clear gap before the digits) instead of the cramped "$800" the
            font produces as one string. */}
        <View style={styles.valueRow}>
          <Text
            style={[
              styles.dollar,
              valueFontSize != null && {
                fontSize: valueFontSize,
                marginRight: valueFontSize * DOLLAR_GAP,
              },
              dead && styles.valueBurned,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={valueFontSize == null}
            allowFontScaling={false}
          >
            $
          </Text>
          <Text
            style={[
              styles.value,
              valueFontSize != null && { fontSize: valueFontSize },
              dead && styles.valueBurned,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={valueFontSize == null}
            allowFontScaling={false}
          >
            {value}
          </Text>
        </View>
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
  cellBurned: {
    backgroundColor: colors.cellBurned,
  },
  cellPressed: {
    backgroundColor: '#0029D6',
  },
  // The scaleX squeeze lives on the row so "$" and the digits compress as one
  // unit — scaling each Text separately would fabricate a gap between them.
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    transform: [{ scaleX: 0.85 }],
  },
  value: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.boardValue,
    letterSpacing: -0.5,
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  dollar: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.boardValue,
    marginRight: 2,
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  valueBurned: {
    opacity: burnedValueOpacity,
    textShadowColor: 'transparent',
  },
});
