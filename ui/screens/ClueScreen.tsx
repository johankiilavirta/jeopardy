import { useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ActiveClue } from '../../src/types';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

/** Horizontal drag (px) past which a release commits the judgement. */
const SWIPE_THRESHOLD = 110;

/** How long the CORRECT/WRONG verdict color holds before committing. */
const VERDICT_HOLD_MS = 500;

interface ClueScreenProps {
  clue: ActiveClue;
  /** Tap: pass on the clue (demo wiring point). */
  onContinue?: (() => void) | undefined;
  /** Swipe judging: right = correct, left = incorrect. Omit to disable swiping. */
  onJudge?: ((correct: boolean) => void) | undefined;
  /** Overrides the default bottom hint text. */
  hint?: string | undefined;
}

export function ClueScreen({ clue, onContinue, onJudge, hint }: ClueScreenProps) {
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(() => {
    if (!onJudge) return null;
    const snapBack = () =>
      Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();

    return PanResponder.create({
      // Claim the gesture only for clearly horizontal drags, so plain taps
      // still reach the Pressable underneath.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: Animated.event([null, { dx: pan }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > SWIPE_THRESHOLD) {
          const correct = g.dx > 0;
          // Slide the card off, hold on the verdict color for a beat, then
          // commit. On a wrong answer the clue stays live (the other player
          // may still buzz), so the same card springs back in — no remount.
          Animated.sequence([
            Animated.timing(pan, {
              toValue: correct ? width : -width,
              duration: 160,
              useNativeDriver: false,
            }),
            Animated.delay(VERDICT_HOLD_MS),
          ]).start(() => {
            onJudge(correct);
            if (!correct) snapBack();
          });
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: snapBack,
    });
  }, [onJudge, pan, width]);

  const correctOpacity = pan.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const incorrectOpacity = pan.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root}>
      {/* Verdict backgrounds revealed as the card slides away */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.bgCorrect, { opacity: correctOpacity }]}
      >
        <Text style={styles.verdictText} allowFontScaling={false}>
          CORRECT
        </Text>
      </Animated.View>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.bgIncorrect, { opacity: incorrectOpacity }]}
      >
        <Text style={styles.verdictText} allowFontScaling={false}>
          WRONG
        </Text>
      </Animated.View>

      <Animated.View
        style={[styles.cardWrap, { transform: [{ translateX: pan }] }]}
        {...(panResponder ? panResponder.panHandlers : {})}
      >
        <Pressable style={styles.card} onPress={onContinue}>
          <View style={styles.header}>
            <Text style={styles.category} numberOfLines={1} allowFontScaling={false}>
              {clue.category.toUpperCase()}
            </Text>
            <Text style={styles.value} numberOfLines={1} allowFontScaling={false}>
              ${clue.value}
            </Text>
          </View>

          <View style={styles.body}>
            <Text style={styles.clueText} allowFontScaling={false}>
              {clue.text.toUpperCase()}
            </Text>
          </View>

          <Text style={styles.hint} allowFontScaling={false}>
            {hint ??
              (onJudge ? '\u2190 WRONG \u00b7 TAP TO PASS \u00b7 CORRECT \u2192' : 'TAP TO CONTINUE')}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  bgCorrect: {
    backgroundColor: colors.judgeCorrect,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgIncorrect: {
    backgroundColor: colors.judgeIncorrect,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verdictText: {
    fontFamily: typeTokens.board,
    fontSize: 54,
    color: '#FFFFFF',
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  cardWrap: {
    flex: 1,
  },
  card: {
    flex: 1,
    backgroundColor: colors.cell,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  category: {
    flexShrink: 1,
    fontFamily: typeTokens.board,
    fontSize: 20,
    color: colors.categoryText,
    transform: [{ scaleX: 0.85 }],
  },
  value: {
    fontFamily: typeTokens.board,
    fontSize: 20,
    color: colors.gold,
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  clueText: {
    fontFamily: typeTokens.ui500,
    fontSize: 26,
    lineHeight: 38,
    letterSpacing: 0.5,
    color: colors.categoryText,
    textAlign: 'center',
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  hint: {
    fontFamily: typeTokens.ui500,
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
});
