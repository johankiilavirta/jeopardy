import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardSheet, useKeyboardSheet } from '../components/KeyboardSheet';
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, type as typeTokens } from '../theme/tokens';

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
  const valid = /^\d{3}$/.test(code);
  const displayCode = code.padEnd(3, '0');
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

  const sheet = useKeyboardSheet(
    // onOpen: center the code input above the keyboard
    () => {
      const layout = codeLayoutRef.current;
      if (!layout.height) return;
      const keyboardTop = height - sheet.panelHeight;
      const targetTop = (keyboardTop - layout.height) / 2;
      const offset = Math.max(0, layout.y - targetTop);
      requestAnimationFrame(() => {
        Animated.timing(formOffset, {
          toValue: -offset,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    },
    // onClose: reset the form offset
    () => resetScroll(true),
  );

  const submit = useCallback(() => {
    if (valid) props.onSubmit(Number(code));
  }, [code, props, valid]);

  const insertDigit = useCallback((digit: string) => {
    setCode(current => `${current}${digit}`.slice(0, 3));
  }, []);

  const backspace = useCallback(() => {
    setCode(current => current.slice(0, -1));
  }, []);

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
        sheet.open();
      } else if (e.key === 'ArrowDown' || e.key === 'Escape') {
        sheet.close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [backspace, sheet, insertDigit, submit]);

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
            onPress={sheet.open}
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

      {props.error && (
        <View style={styles.statusLineWrap}>
          <Text style={styles.statusLine}>{props.error}</Text>
        </View>
      )}

      <KeyboardSheet controls={sheet}>
        <NumberKeyboard dark onInsert={insertDigit} onBackspace={backspace} />
      </KeyboardSheet>
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
});
