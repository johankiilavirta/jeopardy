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
  /** Reports this cell's window-space rect after layout so a clue selected
   *  on the other phone can expand from the matching local board cell. */
  onRect?: ((rect: CellRect) => void) | undefined;
  empty?: boolean;
  onSkip?: (() => void) | undefined;
  /**
   * Board-intro flash delay in ms. When set the cell starts dark and snaps on
   * after this many ms with a quick CRT-strike flash. Only passed for fresh
   * (non-dead) cells on the DJ board intro.
   */
  flashDelay?: number | undefined;
  /** Fires after the final, explicitly-sized value text has laid out. */
  onFinalValueLayout?: (() => void) | undefined;
}

export function BoardCell({ value, valueFontSize, burned, disabled, onPress, onRect, empty, onSkip, flashDelay, onFinalValueLayout }: BoardCellProps) {
  const wrapRef = useRef<View>(null);
  const dead = burned || empty;
  // Board derives this from the actual cell dimensions after its first
  // layout. Rendering the stylesheet's 28pt fallback during that pass lets
  // iOS briefly show a differently fitted value before replacing it with the
  // final size. Leave the amount blank for that one measurement pass instead:
  // when it first becomes visible it already has its final font size.
  const hasFinalValueFont = valueFontSize != null;

  // Capture at mount: the flash effect below only runs once, so a delay that
  // shows up on a later render must not flip a lit cell into dark flash mode
  // with no animation ever scheduled to bring it back.
  const mountFlashDelay = useRef(flashDelay).current;
  const inFlashMode = mountFlashDelay != null && !dead;
  // 0 = dark/off, 1 = lit normal blue
  const flashAnim = useRef(new Animated.Value(0)).current;
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    if (!inFlashMode) return;
    const t = setTimeout(() => {
      Animated.timing(flashAnim, { toValue: 1, duration: 120, useNativeDriver: true }).start(() => setAnimDone(true));
    }, mountFlashDelay!);
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

  const handleLayout = () => {
    if (!onRect) return;
    requestAnimationFrame(() => {
      const node = wrapRef.current;
      if (!node || typeof node.measureInWindow !== 'function') return;
      node.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) onRect({ x, y, width, height });
      });
    });
  };

  if (inFlashMode && !animDone) {
    const textOpacity = flashAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [burnedValueOpacity, 1],
      extrapolate: 'clamp',
    });

    return (
      <View ref={wrapRef} style={styles.cellWrap} onLayout={handleLayout}>
        <View style={[styles.cell, { backgroundColor: colors.cellBurned }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.cell, borderRadius: radius, opacity: flashAnim }]} pointerEvents="none" />
          <Pressable style={styles.pressableInner} onPress={handlePress} disabled={disabled}>
            <Animated.View style={[styles.valueRow, { opacity: textOpacity }]}>
              {hasFinalValueFont && (
                <>
                  <Text
                    style={[styles.dollar, { fontSize: valueFontSize, marginRight: valueFontSize * DOLLAR_GAP }]}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >$</Text>
                  <Text
                    key={`value-${valueFontSize.toFixed(3)}`}
                    style={[styles.value, { fontSize: valueFontSize }]}
                    numberOfLines={1}
                    allowFontScaling={false}
                    onTextLayout={onFinalValueLayout}
                  >{value}</Text>
                </>
              )}
            </Animated.View>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View ref={wrapRef} style={styles.cellWrap} onLayout={handleLayout}>
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
          {hasFinalValueFont && (
            <>
              <Text
                key={`value-${valueFontSize.toFixed(3)}`}
                style={[
                  styles.dollar,
                  { fontSize: valueFontSize, marginRight: valueFontSize * DOLLAR_GAP },
                  dead && styles.valueBurned,
                ]}
                numberOfLines={1}
                allowFontScaling={false}
              >$</Text>
              <Text
                style={[
                  styles.value,
                  { fontSize: valueFontSize },
                  dead && styles.valueBurned,
                ]}
                numberOfLines={1}
                allowFontScaling={false}
                onTextLayout={onFinalValueLayout}
              >{value}</Text>
            </>
          )}
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
