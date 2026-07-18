import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { KeyboardSheet, useKeyboardSheet } from '../components/KeyboardSheet';
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, type as typeTokens } from '../theme/tokens';

const SCREEN_TOP_PADDING = 64;
const SCREEN_SIDE_PADDING = 32;
const TITLE_TO_CONTENT_GAP = 32;
const BUILD_TAG = 'board recovery-2026-07-18';

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
  const scrollRef = useRef<ScrollView | null>(null);
  const sectionYRef = useRef({ main: 0, advanced: 0 });
  const fieldLayoutRef = useRef<Record<SettingsField, { y: number; height: number }>>({
    playerName: { y: 0, height: 0 },
    relayHost: { y: 0, height: 0 },
    relayPort: { y: 0, height: 0 },
  });

  const sheet = useKeyboardSheet(
    undefined,
    // onClose: clear the active field
    () => setActiveField(null),
  );

  const scrollFieldIntoKeyboardWindow = useCallback((field: SettingsField) => {
    const layout = fieldLayoutRef.current[field];
    if (!layout.height) return;
    const keyboardTop = height - sheet.panelHeight;
    const targetTop = (keyboardTop - layout.height) / 2;
    const y = Math.max(0, layout.y - targetTop);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
  }, [height, sheet.panelHeight]);

  const openKeyboard = useCallback((field: SettingsField) => {
    setActiveField(field);
    sheet.open();
    scrollFieldIntoKeyboardWindow(field);
  }, [sheet, scrollFieldIntoKeyboardWindow]);

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

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (!activeField) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspaceChar();
      } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        sheet.close();
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
  }, [activeField, backspaceChar, sheet, insertChar]);

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
            paddingBottom: SCREEN_SIDE_PADDING + sheet.panelHeight,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onTouchStart={() => {
          if (sheet.visible) sheet.close();
        }}
        onScrollBeginDrag={sheet.close}
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
            sheet.close();
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
            <Text style={styles.buildTag}>{BUILD_TAG}</Text>
          </View>
        )}
      </ScrollView>

      <KeyboardSheet controls={sheet}>
        {activeField === 'relayPort' ? (
          <NumberKeyboard dark onInsert={insertChar} onBackspace={backspaceChar} />
        ) : activeField === 'relayHost' ? (
          <HostKeyboard onInsert={insertChar} onBackspace={backspaceChar} />
        ) : (
          <AnswerKeyboard onInsert={insertChar} onBackspace={backspaceChar} final />
        )}
      </KeyboardSheet>
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
  buildTag: {
    marginTop: 8,
    fontFamily: typeTokens.ui500,
    fontSize: 11,
    color: 'rgba(255,255,255,0.16)',
  },
  advancedToggle: {
    marginTop: 24,
  },
  advancedToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#888',
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
