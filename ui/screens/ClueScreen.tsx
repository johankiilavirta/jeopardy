import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ActiveClue } from '../../src/types';
import { ActivationLights, LIGHTS_REST_BOTTOM, LIGHTS_WIDTH_PCT } from '../components/ActivationLights';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { PLAYER_BAR_HEIGHT } from '../components/PlayerHeader';
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

/** Distance from the answer sheet's top lip down to the activation-lights
 *  strip while the sheet is up — the strip lands right under the typed
 *  answer, underlining it as the time drains. */
const LIGHTS_SHEET_OFFSET = 50;

/** Rounded top corners on the answer sheet — the same slid-up-from-below
 *  treatment as the judgement tray's tab. */
const SHEET_RADIUS = 18;

/** The sheet shares the clue card's and score bugs' 2% side insets, so
 *  every broad surface in the game sits on the same horizontal rails. */
const SHEET_WIDTH_PCT = 0.96;

/** Minimum sheet height as a fraction of the screen; the keys stretch to
 *  fill it, and on short screens the content's own minimum wins instead. */
const SHEET_MIN_HEIGHT_PCT = 0.3;

/** The clue card's fixed bottom margin above the player-bar strip (the
 *  overlay fills the screen, so the card keeps PLAYER_BAR_HEIGHT clear
 *  itself): keeps the card 10px clear of the judgement tab's resting top
 *  at any screen size. Exported so the board can match the card's
 *  footprint exactly. */
export const CARD_BOTTOM_MARGIN = 44;

/** The card's (and board's) side inset — a deliberate step in from the
 *  score bugs' 2% rails. Exported so the board matches the card's
 *  footprint; ExpandingClueOverlay's CARD_WIDTH_FRACTION must equal
 *  1 - 2 * this. */
export const CARD_H_PAD = '5%';

interface RevealInfo {
  /** The clue's correct answer, shown on the card in gold. */
  correctAnswer: string;
}

interface ClueScreenProps {
  clue: ActiveClue;
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
  /** Tapping the card while locked unlocks the answer so they can edit it. */
  onUnlockAnswer?: (() => void) | undefined;
  /** Set during REVEAL: the correct answer plus the judged player's attempt. */
  reveal?: RevealInfo | undefined;
  /** P key: skip this clue and return to the board without answering. */
  onSkip?: (() => void) | undefined;
  /** Activation lights in the band under the card: flash on buzzer open,
   *  then drain outside-in until the deadline. Null/undefined hides them. */
  lights?: { deadline: number; durationMs: number; flash: boolean } | null | undefined;
}

export function ClueScreen({
  clue,
  canBuzz,
  showKeyboard,
  canJudge,
  onBuzz,
  onJudge,
  answer,
  onAnswerChange,
  onLockAnswer,
  onUnlockAnswer,
  reveal,
  onSkip,
  lights,
}: ClueScreenProps) {
  const { width, height } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;

  const revealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reveal) {
      Animated.sequence([
        Animated.delay(220), // wait for keyboard to fully slide down
        Animated.timing(revealAnim, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      revealAnim.setValue(0);
    }
  }, [reveal, revealAnim]);

  const revealOpacity = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const answerSlide = revealAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 0],
  });

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
  const [panelHeight, setPanelHeight] = useState(300);
  const kb = useRef(new Animated.Value(0)).current;
  // Live downward drag on the panel (swipe-to-lock follows the finger).
  const kbDrag = useRef(new Animated.Value(0)).current;
  const answerOpacity = useRef(new Animated.Value(0)).current;
  const dragFade = useMemo(() => kbDrag.interpolate({
    inputRange: [0, 50],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  }), [kbDrag]);

  useEffect(() => {
    if (keyboardVisible) {
      kbDrag.setValue(0); // fresh summon — forget any half-drag
      setKbMounted(true);
      Animated.spring(kb, {
        toValue: 1,
        speed: 16,
        bounciness: 4,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          Animated.timing(answerOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      });
    } else {
      Animated.timing(answerOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();

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
  }, [keyboardVisible, kb, kbDrag, answerOpacity]);

  // The sheet slides up from fully below the screen's bottom edge into place.
  const panelRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });
  // The clue glides up in lockstep so it re-centers in the visible card
  // area left above the sheet, shrinking a touch. The card's bottom edge
  // sits CARD_BOTTOM_MARGIN + PLAYER_BAR_HEIGHT above the screen bottom;
  // the sheet's top sits panelHeight above it — half the difference
  // recenters the text, plus half the header strip that fades out while
  // typing (category and value give their space to the clue).
  const clueRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -(panelHeight - CARD_BOTTOM_MARGIN - PLAYER_BAR_HEIGHT) / 2 - 14],
  });
  const clueScale = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.9],
  });
  // Category and value fade away while the keyboard is up — every visible
  // pixel of the card belongs to the clue while answering.
  const headerFade = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  // The activation lights ride along: from their resting band just under
  // the card (LIGHTS_REST_BOTTOM above the player-bar strip) up onto the
  // sheet, landing right under the typed answer. One instance the whole
  // time, so the drain animation never restarts mid-flight.
  const lightsRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [
      0,
      -(panelHeight - PLAYER_BAR_HEIGHT - LIGHTS_REST_BOTTOM - LIGHTS_SHEET_OFFSET),
    ],
  });
  // At rest the strip spans 96% of the clue card (see ActivationLights);
  // the sheet is narrower, so the strip compresses horizontally in flight
  // to land just inside the sheet's edges.
  const stripWidth = Math.min(width * LIGHTS_WIDTH_PCT, 1460);
  const sheetWidth = width * SHEET_WIDTH_PCT;
  const lightsSqueeze = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [1, (sheetWidth - 44) / stripWidth],
  });

  // Hard on/off caret blink next to the typed answer, broadcast style.
  const caretBlink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!kbMounted) return;
    caretBlink.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(caretBlink, { toValue: 0, duration: 40, delay: 520, useNativeDriver: true }),
        Animated.timing(caretBlink, { toValue: 1, duration: 40, delay: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [kbMounted, caretBlink]);

  // Swipe-down on the keyboard panel: if the player has typed at least
  // one character the gesture locks the answer in permanently. If the
  // answer is still empty the keyboard just dismisses — the player can
  // tap the card to bring it back and type before their timer expires.
  const hasLockAnswer = !!onLockAnswer;
  const lockResponder = useMemo(() => {
    if (!hasLockAnswer) return null;
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
          // Latest values via stateRef, so the responder never rebuilds
          // mid-drag on a keystroke.
          const s = stateRef.current;
          if (s.answer) {
            s.onLockAnswer?.(s.answer);
          } else {
            // Nothing typed — just dismiss, don't lock.
            s.setDismissed(true);
          }
        }
        snapBack();
      },
      onPanResponderTerminate: snapBack,
    });
  }, [hasLockAnswer, kbDrag]);

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
    const snapBack = () =>
      Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        if (judgeActive && onJudge) {
          // Swipe to judge
          return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
        } else {
          // Swipe up to unlock/type (dy < -12 and vertical dominates)
          return g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        }
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (judgeActive && onJudge) {
          return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
        } else {
          return g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        }
      },
      onPanResponderMove: (_e, g) => {
        if (judgeActive && onJudge) {
          pan.setValue(g.dx);
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (judgeActive && onJudge) {
          if (Math.abs(g.dx) > SWIPE_THRESHOLD || (Math.abs(g.dx) > 50 && Math.abs(g.vx) > SWIPE_VELOCITY)) {
            commitJudge(g.dx > 0);
          } else {
            snapBack();
          }
        } else {
          const isSwipeUp = g.dy < -30 || (g.dy < -10 && g.vy < -0.1);
          if (isSwipeUp) {
            const s = stateRef.current;
            if (s.dismissed) {
              s.setDismissed(false);
            } else if (onUnlockAnswer) {
              onUnlockAnswer();
            }
          }
        }
      },
      onPanResponderTerminate: () => {
        if (judgeActive && onJudge) snapBack();
      },
    });
  }, [judgeActive, onJudge, pan, commitJudge, onUnlockAnswer]);

  const stateRef = useRef({
    canBuzz,
    onBuzz,
    judgeActive,
    commitJudge,
    onLockAnswer,
    answer,
    showKeyboard,
    onAnswerChange,
    dismissed,
    onSkip,
    setDismissed,
  });
  stateRef.current = { canBuzz, onBuzz, judgeActive, commitJudge, onLockAnswer, answer, showKeyboard, onAnswerChange, dismissed, onSkip, setDismissed };

  // Stable key callbacks (same latest-ref pattern as the keydown handler),
  // so the memoized AnswerKeyboard's 30 keys never re-render while typing.
  const insertChar = useCallback((ch: string) => {
    const s = stateRef.current;
    s.onAnswerChange?.((s.answer ?? '') + ch);
  }, []);
  const backspaceChar = useCallback(() => {
    const s = stateRef.current;
    s.onAnswerChange?.((s.answer ?? '').slice(0, -1));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if ((e.key === 'p' || e.key === 'P') && s.onSkip) { e.preventDefault(); s.onSkip(); return; }
      if (s.canBuzz && s.onBuzz && e.key === ' ') {
        e.preventDefault();
        s.onBuzz();
        return;
      }
      if (s.judgeActive && e.key === 'ArrowRight') { s.commitJudge(true); return; }
      if (s.judgeActive && e.key === 'ArrowLeft') { s.commitJudge(false); return; }
      if (s.onLockAnswer && s.answer && e.key === 'Enter') { s.onLockAnswer(s.answer); return; }
      if (s.showKeyboard && s.onAnswerChange) {
        if (e.key === 'ArrowDown' && !s.dismissed) {
          e.preventDefault();
          if (s.onLockAnswer && s.answer) {
            s.onLockAnswer(s.answer);
          } else {
            s.setDismissed(true);
          }
          return;
        }
        if (e.key === 'ArrowUp' && s.dismissed) { e.preventDefault(); s.setDismissed(false); return; }
        if (e.key === 'Backspace') { e.preventDefault(); s.onAnswerChange((s.answer ?? '').slice(0, -1)); return; }
        if (e.key.length === 1 && /[a-zA-Z0-9 ',.!?-]/.test(e.key)) {
          s.onAnswerChange((s.answer ?? '') + e.key.toUpperCase());
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
                : onUnlockAnswer
                  ? onUnlockAnswer
                  : undefined
          }
        >
          <Animated.View style={[styles.header, { opacity: headerFade }]}>
            <Text style={styles.category} numberOfLines={1} allowFontScaling={false}>
              {clue.category.toUpperCase()}
            </Text>
            <Text style={styles.value} numberOfLines={1} allowFontScaling={false}>
              ${clue.value}
            </Text>
          </Animated.View>

          <View style={styles.body}>
            <Animated.View
              style={{
                transform: [{ translateY: clueRise }, { scale: clueScale }],
                alignItems: 'center',
                position: 'relative',
              }}
            >
              <Text style={styles.clueText} allowFontScaling={false}>
                {clue.text.toUpperCase()}
              </Text>

              {/* The reveal: correct answer in gold under the clue text. */}
              {reveal && (
                <Animated.View
                  style={[
                    styles.revealWrap,
                    {
                      position: 'absolute',
                      top: '100%',
                      left: -400,
                      right: -400,
                      opacity: revealOpacity,
                      transform: [{ translateY: answerSlide }],
                    },
                  ]}
                >
                  <Text style={styles.revealAnswer} allowFontScaling={false}>
                    {reveal.correctAnswer.toUpperCase()}
                  </Text>
                </Animated.View>
              )}
            </Animated.View>
          </View>
        </Pressable>

      </Animated.View>

      {/* The answer sheet: a floating console docked to the true screen
          bottom — centered, at least half the screen tall — sliding up
          over the score bugs and the card's lower edge. One recessed-blue
          surface: the typed answer up top, the lights strip underlining it
          (it rides up from under the card), and the cell-blue keys filling
          the rest. The noop Pressable keeps taps between keys from falling
          through. Swiping the whole sheet down locks the answer in. */}
      {onAnswerChange && kbMounted && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.sheetWrap,
            { transform: [{ translateY: Animated.add(panelRise, kbDrag) }] },
          ]}
        >
          <View
            style={[styles.sheet, { minHeight: Math.round(height * SHEET_MIN_HEIGHT_PCT) }]}
            onLayout={e => setPanelHeight(e.nativeEvent.layout.height)}
            {...(lockResponder ? lockResponder.panHandlers : {})}
          >
            <Pressable onPress={() => {}} style={styles.sheetInner}>
              <Animated.View style={[styles.answerZone, { opacity: Animated.multiply(answerOpacity, dragFade) }]}>
                <Text
                  style={[styles.answerLine, !answer && styles.answerPlaceholder]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {answer || 'TYPE YOUR ANSWER'}
                </Text>
                <Animated.View style={[styles.caret, { opacity: caretBlink }]} />
              </Animated.View>
              <View style={styles.keyDeck}>
                <View style={styles.keyDeckInner}>
                  <AnswerKeyboard onInsert={insertChar} onBackspace={backspaceChar} />
                </View>
              </View>
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* The activation lights live in their own layer, above the sheet,
          inset by the player-bar strip so their resting spot stays glued
          under the card. The sheet's rise (and any live lock-drag) carries
          them up onto it, squeezing to the sheet's width, and back. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.lightsLayer,
          {
            transform: [
              { translateY: Animated.add(lightsRise, kbDrag) },
              { scaleX: lightsSqueeze },
            ],
          },
        ]}
      >
        <ActivationLights lights={lights} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
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
    overflow: 'hidden',
    marginHorizontal: CARD_H_PAD,
    marginTop: '2%',
    // The overlay fills the screen, so the card itself keeps the
    // player-bar strip clear in addition to its own bottom margin.
    marginBottom: CARD_BOTTOM_MARGIN + PLAYER_BAR_HEIGHT,
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
  // Full-width carrier for the slide animation; the sheet centers inside
  // it and touches beside the sheet fall through.
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // One surface in the judgement tray's recessed blue — the slid-up-from-
  // below layer of the design language. Sits on the card's horizontal
  // rails, at least SHEET_MIN_HEIGHT_PCT of the screen tall (set inline),
  // growing if the keys need more room.
  sheet: {
    width: `${SHEET_WIDTH_PCT * 100}%`,
    backgroundColor: colors.cellRecessed,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
  },
  sheetInner: {
    flex: 1,
  },
  // The typed answer sits at the top of the sheet; the lights strip rides
  // up to underline it (the bottom padding is that strip's landing band).
  answerZone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 8,
    paddingBottom: LIGHTS_SHEET_OFFSET - 30,
    paddingHorizontal: 24,
  },
  answerLine: {
    flexShrink: 1,
    fontFamily: typeTokens.ui500,
    fontSize: 24,
    letterSpacing: 1.5,
    color: colors.categoryText,
  },
  // Gold caret — the score widget's value color, blinking where the next
  // character lands.
  caret: {
    width: 3,
    height: 26,
    borderRadius: 1.5,
    backgroundColor: colors.gold,
  },
  // The deck takes all the height left under the answer; the keyboard's
  // rows stretch to share it, so a taller sheet means bigger keys.
  keyDeck: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  keyDeckInner: {
    flex: 1,
    width: '100%',
    maxWidth: 880,
  },
  lightsLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: PLAYER_BAR_HEIGHT,
  },
});
