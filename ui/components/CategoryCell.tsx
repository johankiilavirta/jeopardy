import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { AutoFitText } from './AutoFitText';
import { colors, radius, type as typeTokens } from '../theme/tokens';

/** Padding constants exported so Board can compute matching inner dimensions. */
export const CAT_PAD_X = 3;
export const CAT_PAD_Y = 4;

interface CategoryCellProps {
  name: string;
  /** When set, text starts invisible and turns on after this many ms. */
  flashDelay?: number | undefined;
  /** Pre-computed fit result for equal sizing across all categories. */
  precomputedFit?: { fontSize: number; text: string } | undefined;
}

export function CategoryCell({ name, flashDelay, precomputedFit }: CategoryCellProps) {
  const textOpacity = useRef(new Animated.Value(flashDelay != null ? 0 : 1)).current;

  useEffect(() => {
    if (flashDelay == null) return;
    const t = setTimeout(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: 80, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }, flashDelay);
    return () => clearTimeout(t);
  }, []); // mount-only

  return (
    <View style={styles.cell}>
      <Animated.View style={[styles.textLayer, flashDelay != null && { opacity: textOpacity }]}>
        {precomputedFit ? (
          <View style={styles.fitWrap}>
            <Text
              style={[styles.text, { fontSize: precomputedFit.fontSize, lineHeight: precomputedFit.fontSize * 1.28 }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.2}
              allowFontScaling={false}
            >
              {precomputedFit.text}
            </Text>
          </View>
        ) : (
          <AutoFitText style={styles.text} maxLines={3} min={8} max={44} widthScale={0.85}>
            {name.toUpperCase()}
          </AutoFitText>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: radius,
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  textLayer: {
    flex: 1,
  },
  fitWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: typeTokens.board,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
});
