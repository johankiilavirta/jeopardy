import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { burnedValueOpacity, colors, radius, shadow, type as typeTokens } from '../theme/tokens';

const DOLLAR_GAP = 0.06;

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardCellProps {
  value: number;
  valueFontSize?: number | undefined;
  burned: boolean;
  disabled: boolean;
  onPress: (rect: CellRect) => void;
  empty?: boolean;
  onSkip?: (() => void) | undefined;
  /**
   * Board-intro flash delay in ms. When set the cell starts dark and snaps on
   * after this many ms with a quick CRT-strike flash. Only passed for fresh
   * (non-dead) cells on the DJ board intro.
   */
  flashDelay?: number | undefined;
}

export function BoardCell({ value, valueFontSize, burned, disabled, onPress, empty, onSkip, flashDelay }: BoardCellProps) {
  const wrapRef = useRef<View>(null);
  const dead = burned || empty;

  const inFlashMode = flashDelay != null && !dead;
  // 0 = dark/off, 1 = lit normal blue
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    if (!inFlashMode) return;
    const t = setTimeout(() => {
      Animated.timing(flashAnim, { toValue: 1, duration: 40, useNativeDriver: false }).start(() => setAnimDone(true));
    }, flashDelay!);
    return () => clearTimeout(t);
  }, []); // mount-only — delay captured at birth

  useEffect(() => {
    if (Platform.OS !== 'web' || !onSkip || burned || empty) return;
    const node = wrapRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const handler = (e: Event) => { e.preventDefault(); onSkip(); };
    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
  }, [onSkip, burned, empty]);

  const handlePress = () => {
    const node = wrapRef.current;
    if (node && typeof node.measureInWindow === 'function') {
      node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
    } else {
      onPress({ x: 0, y: 0, width: 0, height: 0 });
    }
  };

  if (inFlashMode && !animDone) {
    const bgColor = flashAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.cellBurned, colors.cell],
      extrapolate: 'clamp',
    });
    const textOpacity = flashAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [burnedValueOpacity, 1],
      extrapolate: 'clamp',
    });

    return (
      <View ref={wrapRef} style={styles.cellWrap}>
        <Animated.View style={[styles.cell, { backgroundColor: bgColor }]}>
          <Pressable style={styles.pressableInner} onPress={handlePress} disabled={disabled}>
            <Animated.View style={[styles.valueRow, { opacity: textOpacity }]}>
              <Text
                style={[styles.dollar, valueFontSize != null && { fontSize: valueFontSize, marginRight: valueFontSize * DOLLAR_GAP }]}
                numberOfLines={1}
                allowFontScaling={false}
              >$</Text>
              <Text
                style={[styles.value, valueFontSize != null && { fontSize: valueFontSize }]}
                numberOfLines={1}
                allowFontScaling={false}
              >{value}</Text>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

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
        <View style={styles.valueRow}>
          <Text
            style={[
              styles.dollar,
              valueFontSize != null && { fontSize: valueFontSize, marginRight: valueFontSize * DOLLAR_GAP },
              dead && styles.valueBurned,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={valueFontSize == null}
            allowFontScaling={false}
          >$</Text>
          <Text
            style={[
              styles.value,
              valueFontSize != null && { fontSize: valueFontSize },
              dead && styles.valueBurned,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={valueFontSize == null}
            allowFontScaling={false}
          >{value}</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cellWrap: { flex: 1 },
  cell: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellBurned: { backgroundColor: colors.cellBurned },
  cellPressed: { backgroundColor: '#1E2C96' },
  pressableInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
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
