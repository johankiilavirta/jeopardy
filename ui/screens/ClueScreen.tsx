import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ActivationLights } from '../components/ActivationLights';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

/** Horizontal drag (px) past which a release commits the judgement. */
const SWIPE_THRESHOLD = 110;
/** Horizontal velocity (px/ms) that commits even below SWIPE_THRESHOLD. */
const SWIPE_VELOCITY = 0.5;

/** Downward drag (px) on the keyboard past which a release locks the answer. */
const LOCK_THRESHOLD = 80;
/** Downward velocity (px/ms) that commits even below LOCK_THRESHOLD. */
const LOCK_VELOCITY = 0.5;

/** How long the CORRECT/WRONG verdict color holds before committing. */
const VERDICT_HOLD_MS = 500;

/** Keyboard panel's resting distance from the bottom edge. The space row
 *  leaves a narrow strip on the left for the countdown display. */
const KEYBOARD_BOTTOM = 12;

/** The clue card's fixed bottom margin inside its overlay (which is itself
 *  inset by PLAYER_BAR_HEIGHT): keeps the card 10px clear of the judgement
 *  tab's resting top at any screen size. Exported so the board can match
 *  the card's footprint exactly. */
export const CARD_BOTTOM_MARGIN = 44;

interface RevealInfo {
  /** The clue's correct answer, shown on the card in gold. */
  correctAnswer: string;
}

interface ClueScreenProps {
  clue: ActiveClue;
  /** Small info line in the bottom-left corner ("4s", "Bob answered…"). */
  statusText?: string | null | undefined;
  /** Tap-to-buzz is live (buzz window open and this player hasn't buzzed). */
  canBuzz?: boolean | undefined;
  /** This player buzzed and is still typing — the keyboard is up. */
  showKeyboard?: boolean | undefined;
  /** Swipe judging is live (REVEAL). */
  canJudge?: boolean | undefined;
  /** Tap-to-buzz: called when the card is tapped while canBuzz. */
  onBuzz?: (() => void) | undefined;
  /** Swipe judging: right = correct, left = incorrect. */
  onJudge?: ((correct: boolean) => void) | undefined;
  /** The player's typed answer, shown above the keys. */
  answer?: string | undefined;
  /** Enables the in-app keyboard (controlled input). */
  onAnswerChange?: ((text: string) => void) | undefined;
  /** Swipe-down on the keyboard locks this final answer in. */
  onLockAnswer?: ((answer: string) => void) | undefined;
  /** Set during REVEAL: the correct answer plus the judged player's attempt. */
  reveal?: RevealInfo | undefined;
  /** P key: skip this clue and return to the board without answering. */
  onSkip?: (() => void) | undefined;
  /** Activation lights in the band under the card: dark while the clue is
   *  read, pulsing while the buzzers are live. Null/undefined hides them. */
  buzzLights?: 'off' | 'live' | null | undefined;
}

export function ClueScreen({
  clue,
  statusText,
  canBuzz,
  showKeyboard,
  canJudge,
  onBuzz,
  onJudge,
  answer,
  onAnswerChange,
  onLockAnswer,
  reveal,
  onSkip,
  buzzLights,
}: ClueScreenProps) {
  const { width } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;

  // The player can swipe the keyboard down without locking if they haven't
  // typed anything yet — it just dismisses temporarily. Tapping the card
  // brings it back. Only a swipe-down with at least one character locks
  // for real. `dismissed` resets whenever `showKeyboard` drops (lock,
  // phase change, timer expiry).
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!showKeyboard) setDismissed(false);
  }, [showKeyboard]);

  // Keyboard slide animation. The keyboard is summoned by the game phase —
  // it rises when this player buzzes and drops when their answer locks
  // (swipe-down, personal timer) or the reveal arrives. The panel stays
  // mounted (`kbMounted`) until the slide-out finishes; a single driver
  // value `kb` (0 hidden → 1 shown) animates the panel and clue together,
  // so rapid open/close just retargets one animation.
  const keyboardVisible = !!showKeyboard && !dismissed && !!onAnswerChange;
  const [kbMounted, setKbMounted] = useState(false);
  const [panelHeight, setPanelHeight] = useState(240);
  const kb = useRef(new Animated.Value(0)).current;
  // Live downward drag on the panel (swipe-to-lock follows the finger).
  const kbDrag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (keyboardVisible) {
      kbDrag.setValue(0); // fresh summon — forget any half-drag
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
  }, [keyboardVisible, kb, kbDrag]);

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

  // Swipe-down on the keyboard panel: if the player has typed at least
  // one character the gesture locks the answer in permanently. If the
  // answer is still empty the keyboard just dismisses — the player can
  // tap the card to bring it back and type before their timer expires.
  const lockResponder = useMemo(() => {
    if (!onLockAnswer) return null;
    const snapBack = () =>
      Animated.spring(kbDrag, { toValue: 0, useNativeDriver: true }).start();

    return PanResponder.create({
      // Claim only clearly-vertical downward drags (mirrors the horizontal
      // judging heuristic), so key taps still land on the keys.
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dy > 12 && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => kbDrag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > LOCK_THRESHOLD || (g.dy > 50 && g.vy > LOCK_VELOCITY)) {
          if (answer) {
            onLockAnswer(answer);
          } else {
            // Nothing typed — just dismiss, don't lock.
            setDismissed(true);
          }
        }
        snapBack();
      },
      onPanResponderTerminate: snapBack,
    });
  }, [onLockAnswer, answer, kbDrag]);

  // Swiping judges the answer on the stand, only once the reveal is up.
  const judgeActive = !!onJudge && !!canJudge;

  const commitJudge = useCallback((correct: boolean) => {
    if (!onJudge) return;
    const snapBack = () =>
      Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();
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
  }, [onJudge, pan, width]);

  const panResponder = useMemo(() => {
    if (!judgeActive || !onJudge) return null;
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
        if (Math.abs(g.dx) > SWIPE_THRESHOLD || (Math.abs(g.dx) > 50 && Math.abs(g.vx) > SWIPE_VELOCITY)) {
          commitJudge(g.dx > 0);
        } else {
          snapBack();
        }
      },
      onPanResponderTerminate: snapBack,
    });
  }, [judgeActive, onJudge, pan, commitJudge]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'p' || e.key === 'P') && onSkip) { e.preventDefault(); onSkip(); return; }
      if (canBuzz && onBuzz && e.key === ' ') {
        e.preventDefault();
        onBuzz();
        return;
      }
      if (judgeActive && e.key === 'ArrowRight') { commitJudge(true); return; }
      if (judgeActive && e.key === 'ArrowLeft') { commitJudge(false); return; }
      if (onLockAnswer && answer && e.key === 'Enter') { onLockAnswer(answer); return; }
      if (showKeyboard && onAnswerChange) {
        if (e.key === 'ArrowDown' && !dismissed) { e.preventDefault(); setDismissed(true); return; }
        if (e.key === 'ArrowUp' && dismissed) { e.preventDefault(); setDismissed(false); return; }
        if (e.key === 'Backspace') { e.preventDefault(); onAnswerChange((answer ?? '').slice(0, -1)); return; }
        if (e.key.length === 1 && /[a-zA-Z0-9 ',.!?-]/.test(e.key)) {
          onAnswerChange((answer ?? '') + e.key.toUpperCase());
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canBuzz, onBuzz, judgeActive, commitJudge, onLockAnswer, answer, showKeyboard, onAnswerChange, dismissed, onSkip]);

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

      {buzzLights != null && <ActivationLights state={buzzLights} />}

      <Animated.View
        style={[styles.cardWrap, { transform: [{ translateX: pan }] }]}
        {...(panResponder ? panResponder.panHandlers : {})}
      >
        {/* Tapping anywhere on the card is the buzzer (only live while the
            window is open and this player hasn't buzzed yet). If the
            keyboard was dismissed without locking, tapping brings it back. */}
        <Pressable
          style={styles.card}
          onPress={
            canBuzz
              ? onBuzz
              : dismissed
                ? () => setDismissed(false)
                : undefined
          }
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

              {/* The reveal: correct answer in gold under the clue text. */}
              {reveal && (
                <View style={styles.revealWrap}>
                  <Text style={styles.revealAnswer} allowFontScaling={false}>
                    {reveal.correctAnswer.toUpperCase()}
                  </Text>
                </View>
              )}
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
            between keys from falling through to the card underneath.
            Swiping the whole panel down locks the answer in. */}
        {onAnswerChange && kbMounted && (
          <Animated.View
            style={[
              styles.keyboardOverlay,
              { transform: [{ translateY: Animated.add(panelRise, kbDrag) }] },
            ]}
            onLayout={e => setPanelHeight(e.nativeEvent.layout.height)}
            {...(lockResponder ? lockResponder.panHandlers : {})}
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
    // The clue is a card floating in dark space, not a full-bleed blue page.
    // Percentage margins scale the dark frame with the screen; the bottom
    // margin is fixed so the card always clears the judgement tab (which
    // tops out 34px above this overlay's bottom edge) by the same 10px.
    marginHorizontal: '2%',
    marginTop: '2%',
    marginBottom: CARD_BOTTOM_MARGIN,
  },
  card: {
    flex: 1,
    backgroundColor: colors.cell,
    paddingHorizontal: 36,
    paddingVertical: 28,
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
    left: 36, // aligns with the card's horizontal padding
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
    // Cap the measure on wide screens — a wall-to-wall single line reads
    // worse than a centered two-liner.
    maxWidth: 880,
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  revealWrap: {
    marginTop: 28,
    alignItems: 'center',
    gap: 10,
  },
  revealAnswer: {
    fontFamily: typeTokens.board,
    fontSize: 30,
    color: colors.gold,
    transform: [{ scaleX: 0.85 }],
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
