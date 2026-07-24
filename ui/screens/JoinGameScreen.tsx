import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ActiveClue } from '../../src/types';
import type { PreferredConnectionMode } from '../../app/sessionStore';
import type { CellRect } from '../components/BoardCell';
import { ClueScreen } from './ClueScreen';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

const CARD_EXPAND_MS = 340;
const CONTENT_FADE_MS = 180;
const KEYBOARD_PAUSE_MS = 650;
const INTRO_HOLD_MS = 5000;
const TEXT_FADE_MS = 170;
const ENTER_CODE_HOLD_MS = 10000;
const SWIPE_HINT_HOLD_MS = 5000;
const EXIT_COMMIT_DISTANCE = 100;
const EXIT_COMMIT_VELOCITY = 0.5;

interface JoinGameScreenProps {
  sourceRect: CellRect | null;
  onSubmit: (roomCode: number) => void;
  onCodeChange: () => void;
  onBack: () => void;
  error: string | null;
  searching: boolean;
  connectionMode: PreferredConnectionMode;
}

export function JoinGameScreen(props: JoinGameScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [displayedClueText, setDisplayedClueText] = useState('JOIN GAME');
  const [introElapsed, setIntroElapsed] = useState(false);
  const [idlePrompt, setIdlePrompt] = useState<'enter-code' | 'swipe-hint'>('enter-code');
  const [targetRect, setTargetRect] = useState<CellRect | null>(null);
  const [targetTextRect, setTargetTextRect] = useState<CellRect | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [handoffComplete, setHandoffComplete] = useState(false);
  const [keyboardReady, setKeyboardReady] = useState(false);
  const cardProgress = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const clueTextOpacity = useRef(new Animated.Value(1)).current;
  const pageX = useRef(new Animated.Value(0)).current;
  // Flipped to 0 the instant a committed swipe fires so chevrons vanish
  // immediately rather than staying lit through the slide-out animation.
  const chevronVisible = useRef(new Animated.Value(1)).current;
  const exitDragRef = useRef(0);
  const exitDirectionRef = useRef<-1 | 1 | null>(null);
  const lastSubmittedCode = useRef<string | null>(null);
  const codeRef = useRef('');
  const displayedClueTextRef = useRef('JOIN GAME');
  const clueTransitionRef = useRef(0);

  const connectionName =
    props.connectionMode === 'bluetooth' ? 'BLUETOOTH' : 'ONLINE';

  const clue = useMemo<ActiveClue>(() => ({
    id: -2,
    category: '',
    value: 0,
    text: displayedClueText,
    answer: '',
    failedPlayerIds: [],
  }), [displayedClueText]);

  const transitionClueText = useCallback((
    nextText: string,
    onHidden?: () => void,
  ) => {
    if (displayedClueTextRef.current === nextText && !onHidden) return;
    const transition = clueTransitionRef.current + 1;
    clueTransitionRef.current = transition;
    clueTextOpacity.stopAnimation();
    Animated.timing(clueTextOpacity, {
      toValue: 0,
      duration: TEXT_FADE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || clueTransitionRef.current !== transition) return;
      onHidden?.();
      displayedClueTextRef.current = nextText;
      setDisplayedClueText(nextText);
      requestAnimationFrame(() => {
        if (clueTransitionRef.current !== transition) return;
        Animated.timing(clueTextOpacity, {
          toValue: 1,
          duration: TEXT_FADE_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    });
  }, [clueTextOpacity]);

  useEffect(() => {
    const timer = setTimeout(() => setIntroElapsed(true), INTRO_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (props.searching || props.error) {
      setIdlePrompt('enter-code');
      return;
    }
    if (!introElapsed) return;
    const timer = setTimeout(
      () => setIdlePrompt(current =>
        current === 'enter-code' ? 'swipe-hint' : 'enter-code',
      ),
      idlePrompt === 'enter-code' ? ENTER_CODE_HOLD_MS : SWIPE_HINT_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [idlePrompt, introElapsed, props.error, props.searching]);

  useEffect(() => {
    if (props.error) {
      const failedCode = codeRef.current;
      transitionClueText('FAILED TO JOIN ROOM', () => {
        if (codeRef.current !== failedCode) return;
        codeRef.current = '';
        lastSubmittedCode.current = null;
        setCode('');
      });
      return;
    }
    if (props.searching) {
      transitionClueText(`SEARCHING FOR ${connectionName} ROOM`);
      return;
    }
    if (introElapsed) {
      transitionClueText(
        idlePrompt === 'enter-code'
          ? `ENTER ${connectionName} GAME CODE`
          : 'SWIPE LEFT TO RETURN TO MAIN MENU',
      );
    }
  }, [
    connectionName,
    idlePrompt,
    introElapsed,
    props.error,
    props.searching,
    transitionClueText,
  ]);

  useEffect(() => {
    if (!targetRect || !targetTextRect) return;
    let keyboardTimer: ReturnType<typeof setTimeout> | null = null;
    const expansion = Animated.timing(cardProgress, {
      toValue: 1,
      duration: CARD_EXPAND_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    expansion.start(({ finished }) => {
      if (!finished) return;
      setExpanded(true);
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: CONTENT_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished: fadeFinished }) => {
        if (fadeFinished) setHandoffComplete(true);
      });
      keyboardTimer = setTimeout(() => setKeyboardReady(true), KEYBOARD_PAUSE_MS);
    });
    return () => {
      expansion.stop();
      if (keyboardTimer) clearTimeout(keyboardTimer);
    };
  }, [cardProgress, contentOpacity, targetRect, targetTextRect]);

  const handleCodeChange = useCallback((next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, 3);
    if (digits === codeRef.current) return;
    codeRef.current = digits;
    props.onCodeChange();
    setCode(digits);
  }, [props]);

  useEffect(() => {
    if (code.length !== 3) {
      lastSubmittedCode.current = null;
      return;
    }
    if (lastSubmittedCode.current === code) return;
    lastSubmittedCode.current = code;
    props.onSubmit(Number(code));
  }, [code, props]);

  const handleCardLayout = useCallback((rect: CellRect) => {
    setTargetRect(current => {
      if (
        current &&
        current.x === rect.x &&
        current.y === rect.y &&
        current.width === rect.width &&
        current.height === rect.height
      ) {
        return current;
      }
      return rect;
    });
  }, []);

  const handleClueTextLayout = useCallback((rect: CellRect) => {
    // Only the pre-keyboard JOIN GAME position is the transition target.
    // Later text/status changes and the keyboard's clue lift must not
    // retarget an animation that has already completed.
    setTargetTextRect(current => current ?? rect);
  }, []);

  const source = props.sourceRect ?? {
    x: width / 2 - 140,
    y: height / 2 - 28,
    width: 280,
    height: 56,
  };
  const target = targetRect ?? source;
  const textTarget = targetTextRect ?? source;
  const frame = {
    left: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.x, target.x],
    }),
    top: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.y, target.y],
    }),
    width: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.width, target.width],
    }),
    height: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.height, target.height],
    }),
    borderRadius: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [6, 0],
    }),
  };
  const backdropOpacity = cardProgress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0, 0, 1],
  });
  const sharedLabelColor = cardProgress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [colors.gold, colors.gold, colors.categoryText],
  });
  const sharedLabelFontSize = cardProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 26],
  });
  const sharedLabelLineHeight = cardProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [24, 38],
  });
  const sharedLabelFrame = {
    left: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.x, textTarget.x],
    }),
    top: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.y, textTarget.y],
    }),
    width: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.width, textTarget.width],
    }),
    height: cardProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [source.height, textTarget.height],
    }),
  };
  const exitIconOpacity = pageX.interpolate({
    inputRange: [-EXIT_COMMIT_DISTANCE, -20, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });
  const exitIconTranslateX = pageX.interpolate({
    inputRange: [-EXIT_COMMIT_DISTANCE, 0],
    outputRange: [0, 68],
    extrapolate: 'clamp',
  });
  const oppositeExitIconOpacity = pageX.interpolate({
    inputRange: [0, 20, EXIT_COMMIT_DISTANCE],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });
  const oppositeExitIconTranslateX = pageX.interpolate({
    inputRange: [0, EXIT_COMMIT_DISTANCE],
    outputRange: [-68, 0],
    extrapolate: 'clamp',
  });

  const returnToMenu = useCallback((direction: -1 | 1) => {
    // Hide chevrons immediately so they don't stay lit through the slide-out.
    chevronVisible.setValue(0);
    Animated.timing(pageX, {
      toValue: direction * width,
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        chevronVisible.setValue(1);
        props.onBack();
      }
    });
  }, [chevronVisible, pageX, props, width]);

  const exitResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      expanded &&
      Math.abs(gesture.dx) > 15 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onPanResponderGrant: () => {
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
    },
    onPanResponderMove: (_event, gesture) => {
      if (exitDirectionRef.current == null && gesture.dx !== 0) {
        exitDirectionRef.current = gesture.dx < 0 ? -1 : 1;
      }
      const direction = exitDirectionRef.current ?? 1;
      const directedDx = direction < 0
        ? Math.min(0, gesture.dx)
        : Math.max(0, gesture.dx);
      const distance = Math.abs(directedDx);
      const resisted = distance <= EXIT_COMMIT_DISTANCE
        ? distance
        : EXIT_COMMIT_DISTANCE + (distance - EXIT_COMMIT_DISTANCE) * 0.15;
      exitDragRef.current = resisted;
      pageX.setValue(direction * resisted);
    },
    onPanResponderRelease: (_event, gesture) => {
      const direction = exitDirectionRef.current;
      const velocityCommitted =
        direction === -1
          ? gesture.vx <= -EXIT_COMMIT_VELOCITY
          : direction === 1
            ? gesture.vx >= EXIT_COMMIT_VELOCITY
            : false;
      if (
        direction &&
        (
          exitDragRef.current >= EXIT_COMMIT_DISTANCE ||
          (exitDragRef.current >= 40 && velocityCommitted)
        )
      ) {
        returnToMenu(direction);
        return;
      }
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
      Animated.spring(pageX, {
        toValue: 0,
        speed: 14,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
      Animated.spring(pageX, {
        toValue: 0,
        speed: 14,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    },
  }), [expanded, pageX, returnToMenu]);

  return (
    <View style={styles.root} {...exitResponder.panHandlers}>
      <Animated.View
        style={[styles.page, { transform: [{ translateX: pageX }] }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
        />
        {!handoffComplete && (
          <>
            <Animated.View pointerEvents="none" style={[styles.sharedCard, frame]} />
            <Animated.View
              pointerEvents="none"
              style={[styles.sharedLabelFrame, sharedLabelFrame]}
            >
            <Animated.Text
              style={[
                styles.sharedLabel,
                {
                  color: sharedLabelColor,
                  fontSize: sharedLabelFontSize,
                  lineHeight: sharedLabelLineHeight,
                },
              ]}
            >
              JOIN GAME
            </Animated.Text>
            </Animated.View>
          </>
        )}

        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}
        >
          <ClueScreen
            clue={clue}
            showKeyboard={keyboardReady}
            answer={code}
            onAnswerChange={handleCodeChange}
            keyboardType="number"
            placeholder=""
            keyboardBottomInset={insets.bottom}
            onCardLayout={handleCardLayout}
            onClueTextLayout={handleClueTextLayout}
            caretPosition="end"
            clueTextOpacity={clueTextOpacity}
            caretColor={colors.categoryText}
          />
        </Animated.View>
      </Animated.View>

      {expanded && (
        <>
          {/* Wrapper zeroed immediately on commit so chevrons vanish before the
              slide-out animation runs (avoids clamped-opacity flash). */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: chevronVisible }]}
          >
            <Animated.View
              style={[
                styles.exitIcon,
                styles.exitIconRight,
                {
                  opacity: exitIconOpacity,
                  transform: [{ translateX: exitIconTranslateX }],
                },
              ]}
            >
              <View style={styles.chevron}>
                <View style={[styles.chevronStroke, styles.chevronTop]} />
                <View style={[styles.chevronStroke, styles.chevronBottom]} />
              </View>
            </Animated.View>
            <Animated.View
              style={[
                styles.exitIcon,
                styles.exitIconLeft,
                {
                  opacity: oppositeExitIconOpacity,
                  transform: [{ translateX: oppositeExitIconTranslateX }],
                },
              ]}
            >
              <View style={[styles.chevron, styles.chevronFlipped]}>
                <View style={[styles.chevronStroke, styles.chevronTop]} />
                <View style={[styles.chevronStroke, styles.chevronBottom]} />
              </View>
            </Animated.View>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  page: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  backdrop: {
    backgroundColor: colors.bg,
  },
  sharedCard: {
    position: 'absolute',
    backgroundColor: colors.cell,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sharedLabel: {
    fontFamily: typeTokens.ui500,
    letterSpacing: 0.5,
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  sharedLabelFrame: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  exitIcon: {
    position: 'absolute',
    top: '45%',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.cellRecessed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitIconRight: {
    right: 8,
  },
  exitIconLeft: {
    left: 8,
  },
  chevron: {
    width: 24,
    height: 24,
  },
  chevronFlipped: {
    transform: [{ scaleX: -1 }],
  },
  chevronStroke: {
    position: 'absolute',
    left: 4,
    width: 14,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  chevronTop: {
    top: 5.25,
    transform: [{ rotate: '-45deg' }],
  },
  chevronBottom: {
    top: 15.25,
    transform: [{ rotate: '45deg' }],
  },
});
