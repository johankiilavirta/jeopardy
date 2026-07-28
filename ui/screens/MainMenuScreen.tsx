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
import { LinearGradient } from 'expo-linear-gradient';
import { AnswerKeyboard } from '../components/AnswerKeyboard';
import { KeyboardSheet, useKeyboardSheet } from '../components/KeyboardSheet';
import { NumberKeyboard } from '../components/NumberKeyboard';
import type { CellRect } from '../components/BoardCell';
import { colors, type as typeTokens } from '../theme/tokens';
import type { PreferredConnectionMode } from '../../app/sessionStore';
import type { QuestionLibraryInfo } from '../../app/questionLibrary';

const SCREEN_TOP_PADDING = 64;
const SCREEN_SIDE_PADDING = 32;
const SETTINGS_COMMIT = 60;
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

interface MainMenuScreenProps {
  onNewGame: () => void;
  onJoinGame: (sourceRect?: CellRect) => void;
  onHistory?: (() => void) | undefined;
  // Settings props — passed through so settings panel lives here
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHost?: string;
  onRelayHostChange?: (host: string) => void;
  relayPort?: string;
  onRelayPortChange?: (port: string) => void;
  connectionMode?: PreferredConnectionMode | undefined;
  onConnectionModeChange?: ((mode: PreferredConnectionMode) => void) | undefined;
  onlinePlayEnabled?: boolean | undefined;
  questionLibrary?: QuestionLibraryInfo | null | undefined;
  questionImportStatus?: string | null | undefined;
  onImportQuestions?: (() => void) | undefined;
  /** Vibrate when buzzing opens. Default off. */
  vibrationEnabled?: boolean | undefined;
  onVibrationChange?: ((enabled: boolean) => void) | undefined;
  /** Read clues aloud on this device when it hosts a game. */
  textToSpeechEnabled?: boolean | undefined;
  onTextToSpeechChange?: ((enabled: boolean) => void) | undefined;
}

export function MainMenuScreen(props: MainMenuScreenProps) {
  const { height } = useWindowDimensions();
  const rootRef = useRef<View>(null);
  const joinButtonRef = useRef<View>(null);

  // ── Settings panel state ──────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeField, setActiveField] = useState<SettingsField | null>(null);
  const [playerKeyboardMode, setPlayerKeyboardMode] = useState<'letters' | 'numbers'>('letters');
  const settingsClosingRef = useRef(false);
  const gradientH = useRef(new Animated.Value(0)).current;
  const settingsContentOpacity = useRef(new Animated.Value(0)).current;
  const settingsDragX = useRef(new Animated.Value(0)).current;
  const settingsDragY = useRef(new Animated.Value(0)).current;
  const settingsAxisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const scrollOffsetRef = useRef(0);
  const advancedYRef = useRef(0);
  const fieldLayoutRef = useRef<Record<SettingsField, { y: number; height: number }>>({
    playerName: { y: 0, height: 0 },
    relayHost: { y: 0, height: 0 },
    relayPort: { y: 0, height: 0 },
  });

  // ── Keyboard sheet ────────────────────────────────────────────────────────
  const sheet = useKeyboardSheet(
    undefined,
    () => setActiveField(null),
  );

  const scrollFieldIntoKeyboardWindow = useCallback((_field: SettingsField) => {
    // No-op: settings panel is non-scrolling; keyboard sheet slides up over content.
  }, []);

  const openKeyboard = useCallback((field: SettingsField) => {
    setActiveField(field);
    if (field === 'playerName') setPlayerKeyboardMode('letters');
    sheet.open();
    scrollFieldIntoKeyboardWindow(field);
  }, [sheet, scrollFieldIntoKeyboardWindow]);

  const insertChar = useCallback((char: string) => {
    if (activeField === 'playerName') {
      props.onNameChange?.(`${props.playerName ?? ''}${char}`.slice(0, 15));
    } else if (activeField === 'relayHost') {
      props.onRelayHostChange?.(`${props.relayHost ?? ''}${char}`.slice(0, 64));
    } else if (activeField === 'relayPort') {
      props.onRelayPortChange?.(`${props.relayPort ?? ''}${char}`.replace(/\D/g, '').slice(0, 5));
    }
  }, [activeField, props]);

  const backspaceChar = useCallback(() => {
    if (activeField === 'playerName') {
      props.onNameChange?.((props.playerName ?? '').slice(0, -1));
    } else if (activeField === 'relayHost') {
      props.onRelayHostChange?.((props.relayHost ?? '').slice(0, -1));
    } else if (activeField === 'relayPort') {
      props.onRelayPortChange?.((props.relayPort ?? '').slice(0, -1));
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
      } else if (activeField === 'playerName' && (/^[a-zA-Z0-9]$/.test(e.key) || e.key === ' ')) {
        e.preventDefault();
        insertChar(e.key === ' ' ? ' ' : e.key.toUpperCase());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeField, backspaceChar, sheet, insertChar]);

  // ── Open / close settings ─────────────────────────────────────────────────
  const openSettings = useCallback(() => {
    sheet.close();
    settingsClosingRef.current = false;
    gradientH.setValue(0);
    settingsContentOpacity.setValue(0);
    setShowSettings(true);
    Animated.timing(gradientH, {
      toValue: height,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      Animated.timing(settingsContentOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, [gradientH, settingsContentOpacity, height, sheet]);

  const closeSettings = useCallback(() => {
    if (settingsClosingRef.current) return;
    settingsClosingRef.current = true;
    sheet.close();
    Animated.timing(settingsContentOpacity, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      Animated.timing(gradientH, {
        toValue: 0,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }).start(({ finished: f }) => {
        if (f) setShowSettings(false);
        else settingsClosingRef.current = false;
      });
    });
  }, [gradientH, settingsContentOpacity, sheet]);

  // ── Settings drag-to-dismiss ──────────────────────────────────────────────
  const settingsPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, gesture) => {
      const isDown =
        gesture.dy > 10 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5 &&
        scrollOffsetRef.current <= 0;
      const isHorizontal =
        Math.abs(gesture.dx) > 10 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
      return isDown || isHorizontal;
    },
    onPanResponderGrant: () => {
      settingsAxisRef.current = null;
      settingsDragX.setValue(0);
      settingsDragY.setValue(0);
    },
    onPanResponderMove: (_e, gesture) => {
      if (!settingsAxisRef.current) {
        if (Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
          settingsAxisRef.current = 'horizontal';
        } else if (gesture.dy > 0) {
          settingsAxisRef.current = 'vertical';
        }
      }
      if (settingsAxisRef.current === 'horizontal') {
        settingsDragX.setValue(gesture.dx);
      } else if (settingsAxisRef.current === 'vertical') {
        settingsDragY.setValue(Math.max(0, gesture.dy));
      }
    },
    onPanResponderRelease: (_e, gesture) => {
      const committed =
        (settingsAxisRef.current === 'horizontal' && (Math.abs(gesture.dx) > SETTINGS_COMMIT || Math.abs(gesture.vx) > 0.7)) ||
        (settingsAxisRef.current === 'vertical' && (gesture.dy > SETTINGS_COMMIT || gesture.vy > 0.7));
      settingsAxisRef.current = null;
      settingsDragX.setValue(0);
      settingsDragY.setValue(0);
      if (committed) closeSettings();
    },
    onPanResponderTerminate: () => {
      settingsAxisRef.current = null;
      settingsDragX.setValue(0);
      settingsDragY.setValue(0);
    },
  }), [closeSettings, settingsDragX, settingsDragY]);

  const leftChevOpacity  = settingsDragX.interpolate({ inputRange: [-SETTINGS_COMMIT, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
  const leftChevTransX   = settingsDragX.interpolate({ inputRange: [-SETTINGS_COMMIT, 0], outputRange: [0, 68], extrapolate: 'clamp' });
  const rightChevOpacity = settingsDragX.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const rightChevTransX  = settingsDragX.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });
  const downChevOpacity  = settingsDragY.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const downChevTransY   = settingsDragY.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });

  // ── Join game with source rect ────────────────────────────────────────────
  const openJoinGame = () => {
    const root = rootRef.current;
    const button = joinButtonRef.current;
    if (!root || !button) {
      props.onJoinGame();
      return;
    }
    root.measureInWindow((rootX, rootY) => {
      button.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          props.onJoinGame();
          return;
        }
        props.onJoinGame({
          x: x - rootX,
          y: y - rootY,
          width,
          height,
        });
      });
    });
  };

  return (
    <View ref={rootRef} collapsable={false} style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={styles.buttons}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={props.onNewGame}
          >
            <Text style={styles.buttonText}>NEW GAME</Text>
          </Pressable>
          <Pressable
            ref={joinButtonRef}
            collapsable={false}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={openJoinGame}
          >
            <Text style={styles.buttonText}>JOIN GAME</Text>
          </Pressable>
          {props.onHistory && (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={props.onHistory}
            >
              <Text style={styles.buttonText}>MATCH HISTORY</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={openSettings}
          >
            <Text style={styles.buttonText}>SETTINGS</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Settings panel — gradient grows from bottom, content fades in */}
      {showSettings && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Phase 1: dark gradient grows upward */}
          <Animated.View
            pointerEvents="none"
            style={[styles.settingsGradientWrap, { height: gradientH }]}
          >
            <LinearGradient
              colors={[colors.backgroundTransparent, colors.background]}
              style={styles.settingsGradientEdge}
              pointerEvents="none"
            />
            <View style={styles.settingsGradientSolid} />
          </Animated.View>

          {/* Phase 2: content fades in */}
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: settingsContentOpacity }]}
            {...settingsPanResponder.panHandlers}
          >
            {/* Drag-left → right chevron */}
            <Animated.View pointerEvents="none" style={[styles.chevIcon, styles.chevIconRight, { opacity: leftChevOpacity, transform: [{ translateX: leftChevTransX }] }]}>
              <View style={styles.chev}>
                <View style={[styles.chevStroke, styles.chevTop]} />
                <View style={[styles.chevStroke, styles.chevBot]} />
              </View>
            </Animated.View>
            {/* Drag-right → left chevron */}
            <Animated.View pointerEvents="none" style={[styles.chevIcon, styles.chevIconLeft, { opacity: rightChevOpacity, transform: [{ translateX: rightChevTransX }] }]}>
              <View style={[styles.chev, styles.chevFlipped]}>
                <View style={[styles.chevStroke, styles.chevTop]} />
                <View style={[styles.chevStroke, styles.chevBot]} />
              </View>
            </Animated.View>
            {/* Drag-down → top chevron */}
            <Animated.View pointerEvents="none" style={[styles.chevIconTop, { opacity: downChevOpacity, transform: [{ translateY: downChevTransY }] }]}>
              <View style={[styles.chev, styles.chevDown]}>
                <View style={[styles.chevStroke, styles.chevTop]} />
                <View style={[styles.chevStroke, styles.chevBot]} />
              </View>
            </Animated.View>

            <View style={styles.settingsContent}>
              <Text style={styles.settingsTitle}>SETTINGS</Text>

              <View style={styles.settingsTwoCol}>
                {/* ── Left column: player identity + connection mode ── */}
                <View style={styles.settingsColLeft}>
                  <View style={styles.settingGroup}>
                    <Text style={styles.label} numberOfLines={1}>PLAYER NAME</Text>
                    <Pressable
                      style={styles.input}
                      accessibilityRole="button"
                      accessibilityLabel={`Player name ${props.playerName || 'empty'}`}
                      onLayout={event => {
                        fieldLayoutRef.current.playerName = {
                          y: event.nativeEvent.layout.y,
                          height: event.nativeEvent.layout.height,
                        };
                      }}
                      onPress={() => openKeyboard('playerName')}
                    >
                      <Text
                        style={[styles.inputText, !props.playerName && styles.inputPlaceholder]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                      >
                        {props.playerName || 'YOUR NAME'}
                      </Text>
                    </Pressable>
                  </View>

                  {props.onImportQuestions && (
                    <View style={styles.settingGroup}>
                      <Text style={styles.label} numberOfLines={1}>QUESTION BANK</Text>
                      <Pressable
                        style={styles.input}
                        accessibilityRole="button"
                        accessibilityLabel="Load one or more question JSON files"
                        onPress={props.onImportQuestions}
                      >
                        <Text
                          style={styles.inputText}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.55}
                        >
                          {props.questionLibrary ? 'UPLOAD & REPLACE' : 'LOAD JSON FILES'}
                        </Text>
                      </Pressable>
                      <Text style={styles.questionStatus} numberOfLines={2}>
                        {props.questionImportStatus ??
                          (props.questionLibrary
                            ? `${props.questionLibrary.gameCount.toLocaleString()} IMPORTED GAMES · ${props.questionLibrary.sourceName}`
                            : 'BUILT-IN GAME 0 READY · NO FILE LOADED')}
                      </Text>
                    </View>
                  )}

                  {props.onlinePlayEnabled && props.connectionMode != null && props.onConnectionModeChange && (
                    <View style={styles.settingGroup}>
                      <Text style={styles.label} numberOfLines={1}>BLUETOOTH</Text>
                      <Pressable
                        accessibilityRole="switch"
                        accessibilityState={{ checked: props.connectionMode === 'bluetooth' }}
                        style={styles.toggleBox}
                        onPress={() => props.onConnectionModeChange?.(
                          props.connectionMode === 'bluetooth' ? 'online' : 'bluetooth',
                        )}
                      >
                        <Text style={[styles.toggleText, props.connectionMode === 'online' && styles.toggleTextOff]}>
                          {props.connectionMode === 'bluetooth' ? 'ON' : 'OFF'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                {/* ── Right column: toggles + advanced ── */}
                <View style={styles.settingsColRight}>
                  <View style={styles.settingGroup}>
                    <Text style={styles.label} numberOfLines={1}>VIBRATION</Text>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: !!props.vibrationEnabled }}
                      style={styles.toggleBox}
                      onPress={() => props.onVibrationChange?.(!props.vibrationEnabled)}
                    >
                      <Text style={[styles.toggleText, !props.vibrationEnabled && styles.toggleTextOff]}>
                        {props.vibrationEnabled ? 'ON' : 'OFF'}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.settingGroup}>
                    <Text style={styles.label} numberOfLines={1}>TEXT TO SPEECH</Text>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: !!props.textToSpeechEnabled }}
                      style={styles.toggleBox}
                      onPress={() => props.onTextToSpeechChange?.(!props.textToSpeechEnabled)}
                    >
                      <Text style={[styles.toggleText, !props.textToSpeechEnabled && styles.toggleTextOff]}>
                        {props.textToSpeechEnabled ? 'ON' : 'OFF'}
                      </Text>
                    </Pressable>
                  </View>

                  {props.onlinePlayEnabled && (
                    <>
                      <Pressable
                        style={styles.advancedToggle}
                        onPress={() => {
                          sheet.close();
                          setShowAdvanced(!showAdvanced);
                        }}
                      >
                        <Text style={styles.advancedToggleText}>
                          {showAdvanced ? '▾ ADVANCED' : '▸ ADVANCED'}
                        </Text>
                      </Pressable>

                      {showAdvanced && (
                        <View
                          style={styles.advancedSection}
                          onLayout={event => {
                            advancedYRef.current = event.nativeEvent.layout.y;
                          }}
                        >
                          <View style={styles.settingGroup}>
                            <Text style={styles.label}>RELAY HOST</Text>
                            <Pressable
                              style={styles.input}
                              accessibilityRole="button"
                              onLayout={event => {
                                fieldLayoutRef.current.relayHost = {
                                  y: advancedYRef.current + event.nativeEvent.layout.y,
                                  height: event.nativeEvent.layout.height,
                                };
                              }}
                              onPress={() => openKeyboard('relayHost')}
                            >
                              <Text
                                style={[styles.inputText, !props.relayHost && styles.inputPlaceholder]}
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.5}
                              >
                                {props.relayHost || 'LOCALHOST'}
                              </Text>
                            </Pressable>
                          </View>

                          <View style={styles.settingGroup}>
                            <Text style={styles.label}>RELAY PORT</Text>
                            <Pressable
                              style={styles.input}
                              accessibilityRole="button"
                              onLayout={event => {
                                fieldLayoutRef.current.relayPort = {
                                  y: advancedYRef.current + event.nativeEvent.layout.y,
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
                          <Text style={styles.buildTag}>{BUILD_TAG}</Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
              </View>

            </View>

            <KeyboardSheet controls={sheet}>
              {activeField === 'relayPort' ? (
                <NumberKeyboard dark onInsert={insertChar} onBackspace={backspaceChar} />
              ) : activeField === 'relayHost' ? (
                <HostKeyboard onInsert={insertChar} onBackspace={backspaceChar} />
              ) : playerKeyboardMode === 'numbers' ? (
                <NumberKeyboard
                  dark
                  onInsert={insertChar}
                  onBackspace={backspaceChar}
                  onLetters={() => setPlayerKeyboardMode('letters')}
                />
              ) : (
                <AnswerKeyboard
                  onInsert={insertChar}
                  onBackspace={backspaceChar}
                  onNumbers={() => setPlayerKeyboardMode('numbers')}
                  final
                />
              )}
            </KeyboardSheet>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SCREEN_SIDE_PADDING,
    paddingTop: SCREEN_TOP_PADDING,
    paddingBottom: SCREEN_SIDE_PADDING,
  },
  buttons: {
    width: '100%',
    maxWidth: 280,
    gap: 12,
  },
  button: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.activeOutline,
  },
  buttonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
  // ── Settings gradient backdrop ───────────────────────────────────────────
  settingsGradientWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  settingsGradientEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
  },
  settingsGradientSolid: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  // ── Dismiss chevrons ─────────────────────────────────────────────────────
  chevIcon: {
    position: 'absolute',
    top: '45%',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.cellRecessed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevIconLeft: { left: 8 },
  chevIconRight: { right: 8 },
  chevIconTop: {
    position: 'absolute',
    top: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.cellRecessed,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  chev: { width: 24, height: 24 },
  chevFlipped: { transform: [{ scaleX: -1 }] },
  chevDown: { transform: [{ rotate: '90deg' }] },
  chevStroke: {
    position: 'absolute',
    left: 4,
    width: 14,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  chevTop: { top: 5.25, transform: [{ rotate: '-45deg' }] },
  chevBot: { top: 15.25, transform: [{ rotate: '45deg' }] },
  // ── Settings content ─────────────────────────────────────────────────────
  settingsContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
  },
  settingsTwoCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 36,
  },
  settingsColLeft: {
    flex: 1,
    gap: 24,
  },
  settingsColRight: {
    flex: 1,
    gap: 24,
  },
  settingGroup: {},
  settingsTitle: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.categoryText,
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    fontFamily: typeTokens.ui700,
    fontSize: 10,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  input: {
    minHeight: 34,
    justifyContent: 'center',
  },
  inputText: {
    fontFamily: typeTokens.board,
    fontSize: 30,
    color: '#fff',
  },
  inputPlaceholder: { color: '#333' },
  questionStatus: {
    marginTop: 2,
    fontFamily: typeTokens.ui500,
    fontSize: 10,
    lineHeight: 13,
    color: '#555',
    letterSpacing: 0.5,
  },
  toggleBox: {
    paddingVertical: 2,
  },
  toggleText: {
    fontFamily: typeTokens.board,
    fontSize: 26,
    color: colors.gold,
  },
  toggleTextOff: {
    color: '#444',
  },
  advancedToggle: {
    minHeight: 28,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  advancedToggleText: {
    fontFamily: typeTokens.ui700,
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#555',
  },
  advancedSection: {
    marginTop: 8,
    gap: 16,
  },
  buildTag: {
    marginTop: 8,
    fontFamily: typeTokens.ui500,
    fontSize: 11,
    color: 'rgba(255,255,255,0.16)',
  },
  hostKeyboard: { flex: 1, gap: 5 },
  hostKeyboardRow: { flex: 1, minHeight: 28, flexDirection: 'row', gap: 5 },
  hostKey: {
    flex: 1,
    backgroundColor: colors.cellFinal,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostKeyPressed: { backgroundColor: colors.activeOutline },
  hostKeyText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#FFFFFF',
  },
});
