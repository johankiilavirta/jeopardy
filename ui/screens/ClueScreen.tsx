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
  type LayoutChangeEvent,
} from 'react-native';
import type { ActiveClue } from '../../src/types';
import { sanitizeText } from '../../src/sanitizeText';
import { ActivationLights, LIGHTS_REST_BOTTOM, LIGHTS_WIDTH_PCT } from '../components/ActivationLights';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { NumberKeyboard } from '../components/NumberKeyboard';
import { PLAYER_BAR_HEIGHT } from '../components/PlayerHeader';
import { colors, shadow, type as typeTokens } from '../theme/tokens';
import {
  shouldCommitSkip,
  SKIP_COMMIT_DISTANCE,
  verticalClueGesture,
  type VerticalClueGesture,
} from './clueGestures';
import {
  clueHeightAvailableForReveal,
  clueLineHeight,
  DEFAULT_CLUE_FONT_SIZE,
  nextFittedClueFontSize,
  REVEAL_ANSWER_GAP,
} from './clueTextFit';

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
  isFinalJeopardyWager?: boolean;
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
  /** Pull-down pass is available for this player on the active clue. */
  canPass?: boolean | undefined;
  /** Commit this player's pass after the pull-down gesture is released. */
  onPass?: (() => void) | undefined;
  /** Tap an answer-only skip reveal to return to the board immediately. */
  onDismiss?: (() => void) | undefined;
  /** Activation lights in the band under the card: flash on buzzer open,
   *  then drain outside-in until the deadline. Null/undefined hides them. */
  lights?: { deadline: number; durationMs: number; flash: boolean } | null | undefined;
  /** The type of keyboard to show. Defaults to 'text'. */
  keyboardType?: 'text' | 'number';
  /** Called when MAX WAGER is pressed on the number keyboard */
  onMaxWager?: (() => void) | undefined;
  /** Prefix for the answer text (e.g. '$') */
  inputPrefix?: string;
  /** Placeholder when answer is empty */
  placeholder?: string;
}

export function ClueScreen({
  clue,
  isFinalJeopardyWager = false,
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
  canPass = false,
  onPass,
  onDismiss,
  lights,
  keyboardType = 'text',
  onMaxWager,
  inputPrefix = '',
  placeholder = 'TYPE YOUR ANSWER',
}: ClueScreenProps) {
  const isFinalJeopardy = clue.id === -1;
  const { width, height } = useWindowDimensions();
  const pan = useRef(new Animated.Value(0)).current;
  const skipDrag = useRef(new Animated.Value(0)).current;
  const skipDistanceRef = useRef(0);
  const verticalGestureRef = useRef<VerticalClueGesture>(null);

  // Normal clues retain the current 26px typography. Only a measured
  // overflow shrinks, and the hidden answer measurement reserves the room
  // that the gold reveal will occupy below the still-centered clue.
  const [bodyHeight, setBodyHeight] = useState(0);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [answerMeasureHeight, setAnswerMeasureHeight] = useState(0);
  const [renderedClueHeight, setRenderedClueHeight] = useState(0);
  const [clueFontSize, setClueFontSize] = useState(DEFAULT_CLUE_FONT_SIZE);
  const availableClueHeight = clueHeightAvailableForReveal(
    bodyHeight,
    answerMeasureHeight,
  );

  useEffect(() => {
    setClueFontSize(DEFAULT_CLUE_FONT_SIZE);
  }, [clue.id, bodyHeight, bodyWidth, answerMeasureHeight]);

  // Layout events can arrive before the body and hidden-answer measurements
  // have made it through React state. Retain the clue height and re-run the
  // fit as each measurement settles instead of depending on another text
  // layout event (Expo Web does not emit one merely because the callback's
  // closure changed).
  useEffect(() => {
    if (
      isFinalJeopardyWager ||
      bodyHeight <= 0 ||
      answerMeasureHeight <= 0 ||
      renderedClueHeight <= 0
    ) return;
    setClueFontSize(current =>
      nextFittedClueFontSize(current, renderedClueHeight, availableClueHeight),
    );
  }, [
    answerMeasureHeight,
    availableClueHeight,
    bodyHeight,
    isFinalJeopardyWager,
    renderedClueHeight,
  ]);

  const handleBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setBodyHeight(current => current === nextHeight ? current : nextHeight);
    setBodyWidth(current => current === nextWidth ? current : nextWidth);
  }, []);

  const handleClueTextLayout = useCallback((event: LayoutChangeEvent) => {
    const renderedHeight = Math.ceil(event.nativeEvent.layout.height);
    setRenderedClueHeight(current => current === renderedHeight ? current : renderedHeight);
  }, []);

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
  const [dismissed, setDismissed] = useState(() => isFinalJeopardy);
  useEffect(() => {
    if (!showKeyboard) setDismissed(isFinalJeopardy);
  }, [showKeyboard, isFinalJeopardy]);
  // The wager and answer phases share one mounted card (same sentinel clue
  // id), and for the last player to lock a wager `showKeyboard` never
  // drops across the transition — the wager keyboard would ride straight
  // into the answer screen, holding the category header at opacity 0.
  // Every final-jeopardy phase starts with the keyboard put away instead.
  useEffect(() => {
    if (isFinalJeopardy) setDismissed(true);
  }, [isFinalJeopardy, isFinalJeopardyWager]);

  // Keyboard slide animation. The keyboard is summoned by the game phase —
  // it rises when this player buzzes and drops when their answer locks
  // (swipe-down, shared deadline) or the reveal arrives. The panel stays
  // mounted (`kbMounted`) until the slide-out finishes; a single driver
  // value `kb` (0 hidden → 1 shown) animates the panel and clue together,
  // so rapid open/close just retargets one animation.
  const keyboardVisible = !!showKeyboard && !dismissed && !!onAnswerChange;
  useEffect(() => {
    if (!keyboardVisible) return;
    // Answering wins over skipping. If the keyboard appears while a skip is
    // being pulled (including through a hardware shortcut), invalidate the
    // gesture immediately so releasing cannot send a stale pass.
    verticalGestureRef.current = null;
    skipDistanceRef.current = 0;
    skipDrag.stopAnimation();
    skipDrag.setValue(0);
  }, [keyboardVisible, skipDrag]);
  const [kbMounted, setKbMounted] = useState(false);
  // The sheet's height: its measured layout once it has mounted, and the
  // styled minimum before then. The keys stretch to fill the minimum, so
  // the estimate is exact in practice — which matters for the final-wager
  // category, anchored to the sheet's top edge before any keyboard exists.
  const minSheetHeight = Math.round(height * SHEET_MIN_HEIGHT_PCT);
  const [measuredPanelHeight, setMeasuredPanelHeight] = useState<number | null>(null);
  const panelHeight = measuredPanelHeight ?? minSheetHeight;
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
  // The sheet's true offset from fully-raised: the phase-driven slide plus
  // any live finger drag. 0 = sheet all the way up, panelHeight = offscreen.
  // Everything that reacts to the keyboard (clue rise/scale, header fade,
  // lights) keys off this instead of `kb` alone, so it tracks the sheet
  // through a swipe-down too — including the drag-to-dismiss slide-out,
  // after which finishDismiss's kb/kbDrag resets are visually no-ops. This
  // matters most on the final-wager screen, where dismissing the keyboard
  // leaves you on the same card instead of changing phase.
  const sheetOffset = Animated.add(panelRise, kbDrag);
  // The clue glides up in lockstep so it re-centers in the visible card
  // area left above the sheet, shrinking a touch. The card's bottom edge
  // sits CARD_BOTTOM_MARGIN + PLAYER_BAR_HEIGHT above the screen bottom;
  // the sheet's top sits panelHeight above it — half the difference
  // recenters the text, plus half the header strip that fades out while
  // typing (category and value give their space to the clue).
  const clueRise = sheetOffset.interpolate({
    inputRange: [0, panelHeight],
    outputRange: [-(panelHeight - CARD_BOTTOM_MARGIN - PLAYER_BAR_HEIGHT) / 2 - 14, 0],
    extrapolate: 'clamp',
  });
  const clueScale = sheetOffset.interpolate({
    inputRange: [0, panelHeight],
    outputRange: [0.9, 1],
    extrapolate: 'clamp',
  });
  // Category and value fade away while the keyboard is up — every visible
  // pixel of the card belongs to the clue while answering.
  const headerFade = sheetOffset.interpolate({
    inputRange: [0, panelHeight],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // The activation lights ride along: from their resting band just under
  // the card (LIGHTS_REST_BOTTOM above the player-bar strip) up onto the
  // sheet, landing right under the typed answer. One instance the whole
  // time, so the drain animation never restarts mid-flight.
  const lightsRise = sheetOffset.interpolate({
    inputRange: [0, panelHeight],
    outputRange: [
      -(panelHeight - PLAYER_BAR_HEIGHT - LIGHTS_REST_BOTTOM - LIGHTS_SHEET_OFFSET),
      0,
    ],
    extrapolate: 'clamp',
  });
  // At rest the strip spans 96% of the clue card (see ActivationLights);
  // the sheet is narrower, so the strip compresses horizontally in flight
  // to land just inside the sheet's edges.
  const stripWidth = Math.min(width * LIGHTS_WIDTH_PCT, 1460);
  const sheetWidth = width * SHEET_WIDTH_PCT;
  const lightsSqueeze = sheetOffset.interpolate({
    inputRange: [0, panelHeight],
    outputRange: [(sheetWidth - 44) / stripWidth, 1],
    extrapolate: 'clamp',
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

  // One screen-level responder owns every vertical gesture. This ordering is
  // the important invariant: a visible keyboard always owns a downward drag;
  // with no keyboard, down pulls SKIP and up is the only swipe that can
  // summon/buzz/unlock. The outer UndoRedoSwipe remains horizontal-only.
  const screenPanResponder = useMemo(() => {
    const snapKeyboardBack = () =>
      Animated.spring(kbDrag, {
        toValue: 0,
        speed: 22,
        bounciness: 0,
        useNativeDriver: true,
      }).start();

    const snapSkipBack = () => {
      skipDistanceRef.current = 0;
      Animated.spring(skipDrag, {
        toValue: 0,
        speed: 14,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    };

    const finishDismiss = () => {
      Animated.timing(kbDrag, {
        toValue: panelHeight,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        // The finger-driven value has already carried the sheet entirely
        // offscreen. Unmount it there, then update game state; do not also
        // run the ordinary slide-out animation or spring the drag to zero.
        kb.setValue(0);
        kbDrag.setValue(0);
        answerOpacity.setValue(0);
        setKbMounted(false);
        const s = stateRef.current;
        if (s.answer) {
          s.onLockAnswer?.(s.answer);
        } else {
          s.setDismissed(true);
        }
      });
    };

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        const s = stateRef.current;
        return verticalClueGesture(g.dx, g.dy, {
          keyboardVisible: s.keyboardVisible,
          canSkip: s.canPass,
          canSummon: s.canBuzz || s.dismissed || !!s.onUnlockAnswer,
        }) != null;
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const s = stateRef.current;
        return verticalClueGesture(g.dx, g.dy, {
          keyboardVisible: s.keyboardVisible,
          canSkip: s.canPass,
          canSummon: s.canBuzz || s.dismissed || !!s.onUnlockAnswer,
        }) != null;
      },
      onPanResponderGrant: () => {
        verticalGestureRef.current = null;
        skipDistanceRef.current = 0;
      },
      onPanResponderMove: (_e, g) => {
        const s = stateRef.current;
        if (verticalGestureRef.current == null) {
          verticalGestureRef.current = verticalClueGesture(g.dx, g.dy, {
            keyboardVisible: s.keyboardVisible,
            canSkip: s.canPass,
            canSummon: s.canBuzz || s.dismissed || !!s.onUnlockAnswer,
          });
        }

        if (verticalGestureRef.current === 'keyboard-dismiss') {
          kbDrag.setValue(Math.min(g.dy, panelHeight));
        } else if (verticalGestureRef.current === 'skip') {
          const distance = Math.max(0, g.dy);
          const resisted = distance <= SKIP_COMMIT_DISTANCE
            ? distance
            : SKIP_COMMIT_DISTANCE + (distance - SKIP_COMMIT_DISTANCE) * 0.12;
          skipDistanceRef.current = resisted;
          skipDrag.setValue(resisted);
        }
      },
      onPanResponderRelease: (_e, g) => {
        const gesture = verticalGestureRef.current;
        verticalGestureRef.current = null;
        if (gesture === 'keyboard-dismiss') {
          // Project a short distance in the release direction so a quick,
          // intentional flick can complete without requiring a long drag.
          const projectedDistance = g.dy + Math.max(0, g.vy) * 120;
          if (g.dy > LOCK_THRESHOLD || (g.dy > 24 && projectedDistance > LOCK_THRESHOLD && g.vy > LOCK_VELOCITY)) {
            finishDismiss();
          } else {
            snapKeyboardBack();
          }
        } else if (gesture === 'skip') {
          const s = stateRef.current;
          const committed =
            s.canPass && shouldCommitSkip(skipDistanceRef.current, s.keyboardVisible);
          snapSkipBack();
          if (committed) s.onPass?.();
        } else if (gesture === 'summon') {
          const isSwipeUp = g.dy < -30 || (g.dy < -10 && g.vy < -0.1);
          if (isSwipeUp) {
            const s = stateRef.current;
            if (s.canBuzz && s.onBuzz) {
              s.onBuzz();
            } else if (s.dismissed) {
              s.setDismissed(false);
            } else if (onUnlockAnswer) {
              onUnlockAnswer();
            }
          }
        }
      },
      onPanResponderTerminate: () => {
        const gesture = verticalGestureRef.current;
        verticalGestureRef.current = null;
        if (gesture === 'keyboard-dismiss') snapKeyboardBack();
        if (gesture === 'skip') snapSkipBack();
      },
    });
  }, [answerOpacity, kb, kbDrag, panelHeight, skipDrag]);

  const stateRef = useRef({
    canBuzz,
    onBuzz,
    onLockAnswer,
    answer,
    showKeyboard,
    onAnswerChange,
    dismissed,
    onSkip,
    keyboardVisible,
    canPass,
    onPass,
    onUnlockAnswer,
    setDismissed,
  });
  stateRef.current = {
    canBuzz,
    onBuzz,
    onLockAnswer,
    answer,
    showKeyboard,
    onAnswerChange,
    dismissed,
    onSkip,
    keyboardVisible,
    canPass,
    onPass,
    onUnlockAnswer,
    setDismissed,
  };

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
      if (s.onLockAnswer && s.answer && e.key === 'Enter') { s.onLockAnswer(s.answer); return; }
      if (e.key === 'ArrowDown' && !s.keyboardVisible && s.canPass) {
        e.preventDefault();
        s.onPass?.();
        return;
      }
      if (s.showKeyboard && s.onAnswerChange) {
        if (e.key === 'ArrowDown' && s.keyboardVisible) {
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

  // Tap-to-buzz / tap-to-summon works anywhere on screen, not just on the
  // card: the full-screen layer below catches taps outside the card, and
  // the card's own Pressable handles the rest with the same logic.
  const handleTap = canBuzz
    ? onBuzz
    : onDismiss
      ? onDismiss
      : dismissed
        ? () => setDismissed(false)
        : onUnlockAnswer;

  const skipTranslateY = skipDrag.interpolate({
    inputRange: [0, SKIP_COMMIT_DISTANCE],
    outputRange: [-68, 0],
    extrapolate: 'clamp',
  });
  const skipOpacity = skipDrag.interpolate({
    inputRange: [0, 20, SKIP_COMMIT_DISTANCE],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });

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
    <View style={styles.root} {...screenPanResponder.panHandlers}>
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

      {/* Full-screen tap catcher for everywhere the card doesn't cover
          (margins, the band below the card): buzzing and summoning the
          keyboard shouldn't require hitting the card itself. */}
      {handleTap && <Pressable style={StyleSheet.absoluteFill} onPress={handleTap} />}

      <Animated.View
        style={[
          styles.cardWrap,
          { transform: [{ translateX: pan }] }
        ]}
        {...(panResponder ? panResponder.panHandlers : {})}
      >
        {/* Tapping anywhere on the card is the buzzer (only live while the
            window is open and this player hasn't buzzed yet). If the
            keyboard was dismissed without locking, tapping brings it back. */}
        <Pressable
          style={[
            styles.card,
            isFinalJeopardy && { backgroundColor: 'transparent', paddingHorizontal: 0 },
          ]}
          onPress={handleTap}
        >
          {/* The FJ card zeroes its horizontal padding, so its header carries
              its own during the wager phase. */}
          <Animated.View
            style={[
              styles.header,
              isFinalJeopardyWager && styles.headerFinalWager,
              { opacity: headerFade },
            ]}
          >
            <View style={styles.categoryWrap}>
              <Text
                style={styles.category}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.55}
                allowFontScaling={false}
              >
                {sanitizeText(clue.category).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.value} numberOfLines={1} allowFontScaling={false}>
              {clue.value ? `$${clue.value}` : ''}
            </Text>
          </Animated.View>

          <View style={styles.body} onLayout={handleBodyLayout}>
            {!isFinalJeopardyWager && (
              <View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.answerMeasure}
              >
                <Text
                  style={styles.revealAnswer}
                  allowFontScaling={false}
                  onLayout={event => {
                    const measured = Math.ceil(event.nativeEvent.layout.height);
                    setAnswerMeasureHeight(current => current === measured ? current : measured);
                  }}
                >
                  {sanitizeText(clue.answer).toUpperCase()}
                </Text>
              </View>
            )}
            <Animated.View
              style={{
                transform: [{ translateY: clueRise }, { scale: clueScale }],
                alignItems: 'center',
                position: 'relative',
              }}
            >
              <Text
                style={[
                  styles.clueText,
                  isFinalJeopardyWager
                    ? styles.wagerCategoryText
                    : { fontSize: clueFontSize, lineHeight: clueLineHeight(clueFontSize) },
                ]}
                allowFontScaling={false}
                onLayout={handleClueTextLayout}
              >
                {sanitizeText(clue.text).toUpperCase()}
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
                    {sanitizeText(reveal.correctAnswer).toUpperCase()}
                  </Text>
                </Animated.View>
              )}
            </Animated.View>
          </View>
        </Pressable>

      </Animated.View>

      {canPass && !keyboardVisible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.skipIconWrap,
            { opacity: skipOpacity, transform: [{ translateY: skipTranslateY }] },
          ]}
        >
          <View style={styles.skipGlyph}>
            <View style={[styles.skipStroke, styles.skipStrokeTop]} />
            <View style={[styles.skipStroke, styles.skipStrokeBottom]} />
          </View>
        </Animated.View>
      )}

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
            style={[
              styles.sheet,
              isFinalJeopardy && styles.sheetFinal,
              { minHeight: minSheetHeight },
            ]}
            onLayout={e => setMeasuredPanelHeight(e.nativeEvent.layout.height)}
          >
            <Pressable onPress={() => {}} style={styles.sheetInner}>
              <Animated.View style={[styles.answerZone, { opacity: Animated.multiply(answerOpacity, dragFade) }]}>
                <Text
                  style={[styles.answerLine, !answer && styles.answerPlaceholder]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {answer ? `${inputPrefix}${answer}` : placeholder}
                </Text>
                <Animated.View style={[styles.caret, { opacity: caretBlink }]} />
              </Animated.View>
              <View style={styles.keyDeck}>
                <View style={styles.keyDeckInner}>
                  {keyboardType === 'number' ? (
                    <NumberKeyboard onInsert={insertChar} onBackspace={backspaceChar} final={isFinalJeopardy} {...(onMaxWager ? { onMaxWager } : {})} />
                  ) : (
                    <AnswerKeyboard onInsert={insertChar} onBackspace={backspaceChar} final={isFinalJeopardy} />
                  )}
                </View>
              </View>
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* The activation lights live in their own layer, above the sheet,
          inset by the player-bar strip so their resting spot stays glued
          under the card. The sheet's rise (and any live lock-drag) carries
          them up onto it, squeezing to the sheet's width, and back —
          kbDrag is already folded into lightsRise via sheetOffset. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.lightsLayer,
          {
            transform: [
              { translateY: lightsRise },
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
  headerFinalWager: {
    paddingHorizontal: 36,
  },
  categoryWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  category: {
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
  answerMeasure: {
    position: 'absolute',
    left: 12,
    right: 12,
    opacity: 0,
    alignItems: 'center',
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
  wagerCategoryText: {
    fontSize: 40,
    lineHeight: 50,
  },
  revealWrap: {
    marginTop: REVEAL_ANSWER_GAP,
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
  skipIconWrap: {
    position: 'absolute',
    top: 8,
    left: '50%',
    marginLeft: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.cellRecessed,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  skipGlyph: {
    width: 24,
    height: 24,
    overflow: 'visible',
    transform: [{ rotate: '-90deg' }],
  },
  skipStroke: {
    position: 'absolute',
    width: 14,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  skipStrokeTop: {
    left: 4,
    top: 5.25,
    transform: [{ rotate: '-45deg' }],
  },
  skipStrokeBottom: {
    left: 4,
    top: 15.25,
    transform: [{ rotate: '45deg' }],
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
  // Final Jeopardy: the sheet trades its recessed navy for the round's
  // recessed charcoal, matching the score bugs and judging tabs.
  sheetFinal: {
    backgroundColor: colors.cellFinalRecessed,
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
