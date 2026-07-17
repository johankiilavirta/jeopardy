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
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, type as typeTokens } from '../theme/tokens';

const SHEET_MIN_HEIGHT = 208;
const SHEET_MAX_HEIGHT = 272;
const SHEET_HEIGHT_PCT = 0.272;
const SHEET_BOTTOM_OVERHANG = 56;
const SHEET_RADIUS = 18;
const DISMISS_THRESHOLD = 80;
const DISMISS_VELOCITY = 0.5;
const SCREEN_TOP_PADDING = 64;
const SCREEN_SIDE_PADDING = 32;
const TITLE_TO_CONTENT_GAP = 32;

interface JoinGameScreenProps {
  onSubmit: (roomCode: number) => void;
  onBack: () => void;
  error: string | null;
}

export function JoinGameScreen(props: JoinGameScreenProps) {
  const { height } = useWindowDimensions();
  const [code, setCode] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardMounted, setKeyboardMounted] = useState(false);
  const valid = /^\d{3}$/.test(code);
  const displayCode = code.padEnd(3, '0');
  const panelHeight = Math.min(
    SHEET_MAX_HEIGHT,
    Math.max(SHEET_MIN_HEIGHT, Math.round(height * SHEET_HEIGHT_PCT)),
  );
  const kb = useRef(new Animated.Value(0)).current;
  const kbDrag = useRef(new Animated.Value(0)).current;
  const formOffset = useRef(new Animated.Value(0)).current;
  const codeLayoutRef = useRef({ y: 0, height: 0 });
  const contentYRef = useRef(0);

  const resetScroll = useCallback((animated = true) => {
    Animated.timing(formOffset, {
      toValue: 0,
      duration: animated ? 180 : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [formOffset]);

  const scrollCodeIntoKeyboardWindow = useCallback(() => {
    const codeLayout = codeLayoutRef.current;
    if (!codeLayout.height) return;
    const keyboardTop = height - panelHeight;
    const targetTop = (keyboardTop - codeLayout.height) / 2;
    const offset = Math.max(0, codeLayout.y - targetTop);
    requestAnimationFrame(() => {
      Animated.timing(formOffset, {
        toValue: -offset,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [formOffset, height, panelHeight]);

  const openKeyboard = useCallback(() => {
    kbDrag.setValue(0);
    setKeyboardMounted(true);
    setKeyboardVisible(true);
    scrollCodeIntoKeyboardWindow();
  }, [kbDrag, scrollCodeIntoKeyboardWindow]);

  const closeKeyboard = useCallback(() => {
    setKeyboardVisible(false);
    resetScroll(true);
  }, [resetScroll]);

  useEffect(() => {
    if (keyboardVisible) {
      Animated.spring(kb, {
        toValue: 1,
        speed: 16,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(kb, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setKeyboardMounted(false);
      });
    }
  }, [keyboardVisible, kb]);

  const submit = useCallback(() => {
    if (valid) props.onSubmit(Number(code));
  }, [code, props, valid]);

  const insertDigit = useCallback((digit: string) => {
    setCode(current => `${current}${digit}`.slice(0, 3));
  }, []);

  const backspace = useCallback(() => {
    setCode(current => current.slice(0, -1));
  }, []);

  const keyboardResponder = useMemo(() => {
    const snapBack = () =>
      Animated.spring(kbDrag, {
        toValue: 0,
        speed: 22,
        bounciness: 0,
        useNativeDriver: true,
      }).start();

    const finishDismiss = () => {
      Animated.timing(kbDrag, {
        toValue: panelHeight,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        kb.setValue(0);
        kbDrag.setValue(0);
        setKeyboardVisible(false);
        setKeyboardMounted(false);
        resetScroll(true);
      });
    };

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        const vertical = Math.abs(g.dy) > 15 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        if (!vertical) return false;
        return keyboardVisible && g.dy > 0;
      },
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        const vertical = Math.abs(g.dy) > 15 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
        if (!vertical) return false;
        return keyboardVisible && g.dy > 0;
      },
      onPanResponderMove: (_e, g) => {
        if (keyboardVisible && g.dy > 0) {
          kbDrag.setValue(Math.min(g.dy, panelHeight));
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (keyboardVisible && g.dy > 0) {
          const projectedDistance = g.dy + Math.max(0, g.vy) * 120;
          if (
            g.dy > DISMISS_THRESHOLD ||
            (g.dy > 24 && projectedDistance > DISMISS_THRESHOLD && g.vy > DISMISS_VELOCITY)
          ) {
            finishDismiss();
          } else {
            snapBack();
          }
        }
      },
      onPanResponderTerminate: snapBack,
    });
  }, [kb, kbDrag, keyboardVisible, panelHeight, resetScroll]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        insertDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        submit();
      } else if (e.key === 'ArrowUp') {
        openKeyboard();
      } else if (e.key === 'ArrowDown' || e.key === 'Escape') {
        closeKeyboard();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [backspace, closeKeyboard, insertDigit, openKeyboard, submit]);

  const panelRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={props.onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>

      <Animated.View
        style={[styles.contentWrap, { transform: [{ translateY: formOffset }] }]}
      >
        <View
          style={styles.content}
          onLayout={event => {
            contentYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <Text
            style={styles.title}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            JOIN GAME
          </Text>

          <Pressable
            style={styles.codeInput}
            accessibilityRole="button"
            accessibilityLabel={`Room code ${code || 'empty'}`}
            onLayout={event => {
              codeLayoutRef.current = {
                y: contentYRef.current + event.nativeEvent.layout.y,
                height: event.nativeEvent.layout.height,
              };
            }}
            onPress={openKeyboard}
          >
            <View style={styles.codeDigits}>
              {[0, 1, 2].map(index => (
                <Text
                  key={index}
                  style={[styles.codeDigit, !code && styles.codePlaceholder]}
                  allowFontScaling={false}
                >
                  {displayCode[index]}
                </Text>
              ))}
            </View>
          </Pressable>

          <Pressable
            style={[styles.joinButton, !valid && styles.joinButtonDisabled]}
            onPress={submit}
            disabled={!valid}
          >
            <Text style={[styles.joinButtonText, !valid && styles.joinButtonTextDisabled]}>
              JOIN
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      {keyboardVisible && (
        <Pressable
          style={styles.dismissLayer}
          accessibilityRole="button"
          accessibilityLabel="Dismiss keyboard"
          onPress={closeKeyboard}
        />
      )}

      {props.error && (
        <View style={styles.statusLineWrap}>
          <Text style={styles.statusLine}>{props.error}</Text>
        </View>
      )}

      {keyboardMounted && (
        <Animated.View
          style={[
            styles.sheetWrap,
            { transform: [{ translateY: Animated.add(panelRise, kbDrag) }] },
          ]}
          {...keyboardResponder.panHandlers}
        >
          <View style={[styles.sheet, { height: panelHeight + SHEET_BOTTOM_OVERHANG }]}>
            <Pressable onPress={() => {}} style={[styles.sheetInner, { height: panelHeight }]}>
              <View style={styles.grabber} />
              <View style={styles.keypad}>
                <NumberKeyboard
                  dark
                  onInsert={insertDigit}
                  onBackspace={backspace}
                />
              </View>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  contentWrap: {
    flex: 1,
    alignItems: 'center',
    paddingTop: SCREEN_TOP_PADDING,
    paddingHorizontal: SCREEN_SIDE_PADDING,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
    zIndex: 3,
  },
  backText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.gold,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.gold,
    marginBottom: TITLE_TO_CONTENT_GAP,
    maxWidth: '100%',
    textAlign: 'center',
  },
  codeInput: {
    borderWidth: 2,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    width: 162,
  },
  codeDigits: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  codeDigit: {
    width: 28,
    fontFamily: typeTokens.board,
    fontSize: 48,
    color: '#fff',
    textAlign: 'center',
  },
  codePlaceholder: {
    color: '#444',
  },
  statusLineWrap: {
    position: 'absolute',
    left: 24,
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
  joinButton: {
    marginTop: 24,
    backgroundColor: colors.cell,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 6,
  },
  joinButtonDisabled: {
    opacity: 0.4,
  },
  joinButtonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
  joinButtonTextDisabled: {
    color: '#666',
  },
  dismissLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -SHEET_BOTTOM_OVERHANG,
    alignItems: 'center',
    zIndex: 2,
  },
  sheet: {
    width: '96%',
    backgroundColor: colors.cellFinalRecessed,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: 'hidden',
  },
  sheetInner: {
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginTop: 10,
    marginBottom: 10,
  },
  keypad: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
