import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
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

type SettingsField = 'playerName' | 'relayHost' | 'relayPort';

const HOST_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ['.', '-', ':', '⌫'],
];

function HostKeyboard({ onInsert, onBackspace }: { onInsert: (char: string) => void; onBackspace: () => void }) {
  return (
    <View style={styles.hostKeyboard}>
      {HOST_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.hostKeyboardRow}>
          {row.map(label => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.hostKey, pressed && styles.hostKeyPressed]}
              onPress={() => {
                if (label === '⌫') onBackspace();
                else onInsert(label.toLowerCase());
              }}
            >
              <Text style={styles.hostKeyText} allowFontScaling={false}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

interface SettingsScreenProps {
  playerName: string;
  onNameChange: (name: string) => void;
  relayHost: string;
  onRelayHostChange: (host: string) => void;
  relayPort: string;
  onRelayPortChange: (port: string) => void;
  onBack: () => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { height } = useWindowDimensions();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeField, setActiveField] = useState<SettingsField | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardMounted, setKeyboardMounted] = useState(false);
  const panelHeight = Math.min(
    SHEET_MAX_HEIGHT,
    Math.max(SHEET_MIN_HEIGHT, Math.round(height * SHEET_HEIGHT_PCT)),
  );
  const kb = useRef(new Animated.Value(0)).current;
  const kbDrag = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionYRef = useRef({ main: 0, advanced: 0 });
  const fieldLayoutRef = useRef<Record<SettingsField, { y: number; height: number }>>({
    playerName: { y: 0, height: 0 },
    relayHost: { y: 0, height: 0 },
    relayPort: { y: 0, height: 0 },
  });

  const scrollFieldIntoKeyboardWindow = useCallback((field: SettingsField) => {
    const layout = fieldLayoutRef.current[field];
    if (!layout.height) return;
    const keyboardTop = height - panelHeight;
    const targetTop = (keyboardTop - layout.height) / 2;
    const y = Math.max(0, layout.y - targetTop);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
  }, [height, panelHeight]);

  const openKeyboard = useCallback((field: SettingsField) => {
    kbDrag.setValue(0);
    setActiveField(field);
    setKeyboardMounted(true);
    setKeyboardVisible(true);
    scrollFieldIntoKeyboardWindow(field);
  }, [kbDrag, scrollFieldIntoKeyboardWindow]);

  const closeKeyboard = useCallback(() => {
    setKeyboardVisible(false);
  }, []);

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
        if (finished) {
          setKeyboardMounted(false);
          setActiveField(null);
        }
      });
    }
  }, [keyboardVisible, kb]);

  const insertChar = useCallback((char: string) => {
    if (activeField === 'playerName') {
      props.onNameChange(`${props.playerName}${char}`.slice(0, 24));
    } else if (activeField === 'relayHost') {
      props.onRelayHostChange(`${props.relayHost}${char}`.slice(0, 64));
    } else if (activeField === 'relayPort') {
      props.onRelayPortChange(`${props.relayPort}${char}`.replace(/\D/g, '').slice(0, 5));
    }
  }, [activeField, props]);

  const backspaceChar = useCallback(() => {
    if (activeField === 'playerName') {
      props.onNameChange(props.playerName.slice(0, -1));
    } else if (activeField === 'relayHost') {
      props.onRelayHostChange(props.relayHost.slice(0, -1));
    } else if (activeField === 'relayPort') {
      props.onRelayPortChange(props.relayPort.slice(0, -1));
    }
  }, [activeField, props]);

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
        setActiveField(null);
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
  }, [kb, kbDrag, keyboardVisible, panelHeight]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (!activeField) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspaceChar();
      } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        closeKeyboard();
      } else if (activeField === 'relayPort' && /^\d$/.test(e.key)) {
        e.preventDefault();
        insertChar(e.key);
      } else if (activeField === 'relayHost' && /^[a-zA-Z0-9.:-]$/.test(e.key)) {
        e.preventDefault();
        insertChar(e.key.toLowerCase());
      } else if (activeField === 'playerName' && (/^[a-zA-Z]$/.test(e.key) || e.key === ' ')) {
        e.preventDefault();
        insertChar(e.key === ' ' ? ' ' : e.key.toUpperCase());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeField, backspaceChar, closeKeyboard, insertChar]);

  const panelRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={props.onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            minHeight: height,
            paddingBottom: SCREEN_SIDE_PADDING + panelHeight,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onTouchStart={() => {
          if (keyboardVisible) closeKeyboard();
        }}
        onScrollBeginDrag={closeKeyboard}
        scrollEventThrottle={16}
      >
        <Text style={styles.title}>SETTINGS</Text>

        <View
          style={styles.section}
          onLayout={event => {
            sectionYRef.current.main = event.nativeEvent.layout.y;
          }}
        >
          <Text style={styles.label}>Player Name</Text>
          <Pressable
            style={styles.input}
            accessibilityRole="button"
            accessibilityLabel={`Player name ${props.playerName || 'empty'}`}
            onLayout={event => {
              fieldLayoutRef.current.playerName = {
                y: sectionYRef.current.main + event.nativeEvent.layout.y,
                height: event.nativeEvent.layout.height,
              };
            }}
            onPress={() => openKeyboard('playerName')}
          >
            <Text style={[styles.inputText, !props.playerName && styles.inputPlaceholder]}>
              {props.playerName || 'Your name'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.advancedToggle}
          onPress={() => {
            closeKeyboard();
            setShowAdvanced(!showAdvanced);
          }}
        >
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
          </Text>
        </Pressable>

        {showAdvanced && (
          <View
            style={styles.section}
            onLayout={event => {
              sectionYRef.current.advanced = event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.label}>Relay Host</Text>
            <Pressable
              style={styles.input}
              accessibilityRole="button"
              accessibilityLabel={`Relay host ${props.relayHost || 'empty'}`}
              onLayout={event => {
                fieldLayoutRef.current.relayHost = {
                  y: sectionYRef.current.advanced + event.nativeEvent.layout.y,
                  height: event.nativeEvent.layout.height,
                };
              }}
              onPress={() => openKeyboard('relayHost')}
            >
              <Text style={[styles.inputText, !props.relayHost && styles.inputPlaceholder]}>
                {props.relayHost || 'localhost'}
              </Text>
            </Pressable>
            <Text style={styles.label}>Relay Port</Text>
            <Pressable
              style={styles.input}
              accessibilityRole="button"
              accessibilityLabel={`Relay port ${props.relayPort || 'empty'}`}
              onLayout={event => {
                fieldLayoutRef.current.relayPort = {
                  y: sectionYRef.current.advanced + event.nativeEvent.layout.y,
                  height: event.nativeEvent.layout.height,
                };
              }}
              onPress={() => openKeyboard('relayPort')}
            >
              <Text style={[styles.inputText, !props.relayPort && styles.inputPlaceholder]}>
                {props.relayPort || '8787'}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

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
                {activeField === 'relayPort' ? (
                  <NumberKeyboard dark onInsert={insertChar} onBackspace={backspaceChar} />
                ) : activeField === 'relayHost' ? (
                  <HostKeyboard onInsert={insertChar} onBackspace={backspaceChar} />
                ) : (
                  <AnswerKeyboard onInsert={insertChar} onBackspace={backspaceChar} final />
                )}
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
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SCREEN_SIDE_PADDING,
    paddingTop: SCREEN_TOP_PADDING,
    paddingBottom: SCREEN_SIDE_PADDING,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
    zIndex: 1,
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
  },
  section: {
    width: '100%',
    maxWidth: 280,
  },
  label: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
    minHeight: 42,
    justifyContent: 'center',
  },
  inputText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
  },
  inputPlaceholder: {
    color: '#666',
  },
  advancedToggle: {
    marginTop: 24,
  },
  advancedToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#888',
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
  hostKeyboard: {
    flex: 1,
    gap: 5,
  },
  hostKeyboardRow: {
    flex: 1,
    minHeight: 28,
    flexDirection: 'row',
    gap: 5,
  },
  hostKey: {
    flex: 1,
    backgroundColor: colors.cellFinal,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostKeyPressed: {
    backgroundColor: colors.activeOutline,
  },
  hostKeyText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
