import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ActiveClue, GameStatus } from '../../src/types';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

/** Horizontal drag (px) past which a release commits the judgement. */
const SWIPE_THRESHOLD = 110;

/** How long the CORRECT/WRONG verdict color holds before committing. */
const VERDICT_HOLD_MS = 500;

/** Keyboard panel's resting distance from the bottom edge. The space row
 *  leaves a narrow strip on the left for the countdown display. */
const KEYBOARD_BOTTOM = 12;

interface ClueScreenProps {
  clue: ActiveClue;
  /** Current phase — drives tap-to-buzz, the keyboard and swipe judging. */
  status: GameStatus;
  /** Small info line in the bottom-left corner ("Anyone can answer 4s"). */
  statusText?: string | null | undefined;
  /** Tap-to-buzz: called when the card is tapped during BUZZ_OPEN. */
  onBuzz?: (() => void) | undefined;
  /** Swipe judging during ANSWER_PHASE: right = correct, left = incorrect. */
  onJudge?: ((correct: boolean) => void) | undefined;
  /** The player's typed answer, shown above the keys. */
  answer?: string | undefined;
  /** Enables the in-app keyboard, summoned by ANSWER_PHASE (controlled). */
  onAnswerChange?: ((text: string) => void) | undefined;
}

export function ClueScreen({
  clue,
  status,
  statusText,
  onBuzz,
  onJudge,
  answer,
  onAnswerChange,
}: ClueScreenProps) {
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;

  // Keyboard slide animation. The keyboard is summoned by the game phase —
  // it rises when the player wins the buzz (ANSWER_PHASE) and drops when the
  // answer locks or on the verdict. The panel stays mounted (`kbMounted`) until the slide-out
  // finishes; a single driver value `kb` (0 hidden → 1 shown) animates the
  // panel and clue together, so rapid open/close just retargets one
  // animation.
  const keyboardVisible = status === 'ANSWER_PHASE' && !!onAnswerChange;
  const [kbMounted, setKbMounted] = useState(false);
  const [panelHeight, setPanelHeight] = useState(240);
  const kb = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (keyboardVisible) {
      setKbMounted(true);
      Animated.spring(kb, {
        toValue: 1,
        speed: 16,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    } else {
      // Interrupting this with a reopen calls back with finished: false,
      // so we never unmount mid-slide.
      Animated.timing(kb, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setKbMounted(false);
      });
    }
  }, [keyboardVisible, kb]);

  // Panel slides up from just below the bottom edge into place.
  const panelRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight + KEYBOARD_BOTTOM, 0],
  });
  // The clue glides up in lockstep so it re-centers in the space left
  // above the panel (half the panel's height) instead of hiding behind
  // the glass, shrinking a touch to keep clear of the header.
  const clueRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -panelHeight / 2],
  });
  const clueScale = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.9],
  });

  // Swiping judges an answer attempt: live while answering and after the
  // input locks (the verdict is always up to the players).
  const canJudge = !!onJudge && (status === 'ANSWER_PHASE' || status === 'ANSWER_LOCKED');
  const panResponder = useMemo(() => {
    if (!canJudge || !onJudge) return null;
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
  }, [canJudge, onJudge, pan, width]);

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
        {/* Tapping anywhere on the card is the buzzer (only live during
            the buzz window — the reducer rejects everything else anyway). */}
        <Pressable
          style={styles.card}
          onPress={status === 'BUZZ_OPEN' ? onBuzz : undefined}
        >
          <View style={styles.header}>
            <Text style={styles.category} numberOfLines={1} allowFontScaling={false}>
              {clue.category.toUpperCase()}
            </Text>
            <Text style={styles.value} numberOfLines={1} allowFontScaling={false}>
              ${clue.value}
            </Text>
          </View>

          <View style={styles.body}>
            <Animated.View
              style={{ transform: [{ translateY: clueRise }, { scale: clueScale }] }}
            >
              <Text style={styles.clueText} allowFontScaling={false}>
                {clue.text.toUpperCase()}
              </Text>
            </Animated.View>
          </View>
        </Pressable>

        {/* Countdown line, bottom-left: just the countdown number during
            timed phases ("8s", "3s", etc), or player answer info when
            locked/expired. Static — sits beside the space bar. */}
        {statusText != null && (
          <View style={styles.statusLineWrap} pointerEvents="none">
            <Text style={styles.statusLine} numberOfLines={1} allowFontScaling={false}>
              {statusText}
            </Text>
          </View>
        )}

        {/* Floating keyboard: slides up over the lower card with the typed
            answer right above the keys. No panel background — only the keys
            and answer line float over the card, so the static status line
            in the corner stays visible. The noop Pressable keeps taps
            between keys from falling through to the card underneath. */}
        {onAnswerChange && kbMounted && (
          <Animated.View
            style={[styles.keyboardOverlay, { transform: [{ translateY: panelRise }] }]}
            onLayout={e => setPanelHeight(e.nativeEvent.layout.height)}
          >
            <Pressable onPress={() => {}} style={styles.panel}>
              <Text
                style={[styles.answerLine, !answer && styles.answerPlaceholder]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {answer || 'TYPE YOUR ANSWER'}
              </Text>
              <AnswerKeyboard
                onInsert={ch => onAnswerChange((answer ?? '') + ch)}
                onBackspace={() => onAnswerChange((answer ?? '').slice(0, -1))}
              />
            </Pressable>
          </Animated.View>
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
  answerPlaceholder: {
    color: 'rgba(255,255,255,0.35)',
  },
  statusLineWrap: {
    position: 'absolute',
    left: 24, // aligns with the card's horizontal padding
    // The countdown sits on the keyboard's bottom row (flex:1 of the space bar).
    // Vertically centered on the key height (40px), with the space bar taking
    // flex:4 to its right. Just the number — "8s", "3s", etc.
    bottom: 20,
    height: 40,
    justifyContent: 'center',
  },
  statusLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.65)',
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
    bottom: KEYBOARD_BOTTOM,
  },
  panel: {
    // Fully transparent — just lays out the answer line over the keys.
    padding: 8,
    gap: 6,
  },
  answerLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    letterSpacing: 1,
    color: colors.categoryText,
    textAlign: 'center',
    paddingVertical: 2,
  },
});
