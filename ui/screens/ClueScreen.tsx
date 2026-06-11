import { BlurView } from 'expo-blur';
import { useMemo, useRef, useState } from 'react';
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
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { colors, radius, shadow, type as typeTokens } from '../theme/tokens';

/** Horizontal drag (px) past which a release commits the judgement. */
const SWIPE_THRESHOLD = 110;

/** How long the CORRECT/WRONG verdict color holds before committing. */
const VERDICT_HOLD_MS = 500;

interface ClueScreenProps {
  clue: ActiveClue;
  /** Swipe judging: right = correct, left = incorrect. Omit to disable swiping. */
  onJudge?: ((correct: boolean) => void) | undefined;
  /** The player's typed answer, shown below the top bar. */
  answer?: string | undefined;
  /** Enables the answer line + in-app keyboard (controlled). */
  onAnswerChange?: ((text: string) => void) | undefined;
}

export function ClueScreen({ clue, onJudge, answer, onAnswerChange }: ClueScreenProps) {
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;
  const [keyboardVisible, setKeyboardVisible] = useState(false);

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
        {/* Tapping anywhere on the card (outside the answer line / keys)
            hides the keyboard. */}
        <Pressable style={styles.card} onPress={() => setKeyboardVisible(false)}>
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
        </Pressable>

        {/* Floating answer affordance below the header — absolutely
            positioned so the centered clue text never reflows. Hidden while
            the keyboard is up (the glass panel shows the answer instead). */}
        {onAnswerChange && !keyboardVisible && (
          <Pressable style={styles.answerLineWrap} onPress={() => setKeyboardVisible(true)}>
            <Text
              style={[styles.answerLine, !answer && styles.answerPlaceholder]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {answer || 'TYPE YOUR ANSWER'}
            </Text>
          </Pressable>
        )}

        {/* Liquid-glass keyboard: materializes over the lower card with the
            typed answer right above the keys; the clue stays put behind it.
            The noop Pressable keeps taps between keys from falling through
            to the card (which would dismiss the keyboard). */}
        {onAnswerChange && keyboardVisible && (
          <Pressable style={styles.keyboardOverlay} onPress={() => {}}>
            <BlurView intensity={25} tint="dark" style={styles.glass}>
              <Text
                style={[styles.glassAnswer, !answer && styles.answerPlaceholder]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {answer || 'TYPE YOUR ANSWER'}
              </Text>
              <AnswerKeyboard
                onInsert={ch => onAnswerChange((answer ?? '') + ch)}
                onBackspace={() => onAnswerChange((answer ?? '').slice(0, -1))}
              />
            </BlurView>
          </Pressable>
        )}
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
    alignItems: 'center',
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
  answerLineWrap: {
    // Floats below the top bar without affecting the card's flow.
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  answerLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.categoryText,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  answerPlaceholder: {
    color: 'rgba(255,255,255,0.35)',
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
  keyboardOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  glass: {
    // Frosted panel over the broadcast blue — the clue stays readable
    // through it. BlurView needs overflow hidden to clip to the radius.
    borderRadius: radius,
    overflow: 'hidden',
    padding: 8,
    gap: 6,
  },
  glassAnswer: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    letterSpacing: 1,
    color: colors.categoryText,
    textAlign: 'center',
    paddingVertical: 2,
  },
});
