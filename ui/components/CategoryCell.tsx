import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { AutoFitText } from './AutoFitText';
import { colors, radius, type as typeTokens } from '../theme/tokens';

interface CategoryCellProps {
  name: string;
  /** When set, text starts invisible and turns on after this many ms. */
  flashDelay?: number | undefined;
}

export function CategoryCell({ name, flashDelay }: CategoryCellProps) {
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
        <AutoFitText style={styles.text} maxLines={3} min={8} max={44} widthScale={0.85}>
          {name.toUpperCase()}
        </AutoFitText>
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
  text: {
    fontFamily: typeTokens.board,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
});
