import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

/** How long each category card sits on screen before pushing to the next. */
const HOLD_MS = 966;
/** Duration of the horizontal push between two cards. */
const SLIDE_MS = 254;
/** Fade of the whole overlay after the last card, revealing the board behind. */
const FADE_MS = 300;

interface CategoryIntroProps {
  /** Category names in board order. The 6th (backfilled) category should
   *  already carry its trailing " *". */
  categories: string[];
  /** Called once the last card has been held — reveal the board. */
  onDone: () => void;
}

/**
 * Round-intro fly-by: the category title cards scroll past horizontally, one
 * at a time, like the show reading out the categories. The cards sit edge to
 * edge on a single strip and we translate the strip left by one screen width
 * per step (a constant-speed "push"). After the last card it fades out to
 * reveal the board behind. Tap anywhere to drop the intro instantly. Mount
 * this keyed by round so each round replays its own intro.
 */
export function CategoryIntro({ categories, onDone }: CategoryIntroProps) {
  const tx = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  const begin = useCallback(
    (e: LayoutChangeEvent) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      if (startedRef.current || w <= 0) return;
      startedRef.current = true;
      setSize({ w, h });

      const n = categories.length;
      // Hold on each card, then push to the next; on the last card, hold and
      // then fade the whole overlay out to reveal the board already behind it.
      const steps: Animated.CompositeAnimation[] = [];
      for (let i = 0; i < n; i++) {
        steps.push(Animated.delay(HOLD_MS));
        if (i < n - 1) {
          steps.push(
            Animated.timing(tx, {
              toValue: -(i + 1) * w,
              duration: SLIDE_MS,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          );
        }
      }
      steps.push(
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      );
      Animated.sequence(steps).start(({ finished }) => {
        if (finished) finish();
      });
    },
    [categories.length, finish, tx, opacity],
  );

  // Dark frame around the blue card, matching the broadcast proportions:
  // ~7% of width on the sides, ~12% of height top and bottom.
  const pad = size ? { paddingHorizontal: size.w * 0.07, paddingVertical: size.h * 0.12 } : null;

  return (
    <Animated.View style={[styles.fill, { opacity }]}>
      <Pressable style={styles.fill} onPress={finish} onLayout={begin}>
        {size && (
          <Animated.View
            style={[
              styles.strip,
              { width: size.w * categories.length, transform: [{ translateX: tx }] },
            ]}
          >
            {categories.map((name, i) => (
              <View key={i} style={[styles.slot, { width: size.w }, pad]}>
                <View style={styles.card}>
                  <Text style={styles.categoryText} adjustsFontSizeToFit numberOfLines={4}>
                    {name.toUpperCase()}
                  </Text>
                </View>
              </View>
            ))}
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    height: '100%',
  },
  // Each slot is a full screen-width column on the dark background; the blue
  // card is inset within it, so the dark frame shows on all sides and the gap
  // between two cards' frames reads as a dark sliver during the push.
  slot: {
    height: '100%',
    backgroundColor: colors.bg,
  },
  card: {
    flex: 1,
    backgroundColor: colors.cell,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  categoryText: {
    fontFamily: typeTokens.board,
    fontSize: 48,
    lineHeight: 54,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
});
