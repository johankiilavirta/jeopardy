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
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, type as typeTokens } from '../theme/tokens';

const SETTINGS_COMMIT = 60;
const SHEET_MIN_HEIGHT = 208;
const SHEET_MAX_HEIGHT = 272;
const SHEET_HEIGHT_PCT = 0.272;
const SHEET_BOTTOM_OVERHANG = 56;
const SHEET_RADIUS = 18;
const DISMISS_THRESHOLD = 80;
const DISMISS_VELOCITY = 0.5;
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

interface InGameSettingsScreenProps {
  onClose: () => void;
  onQuit: () => void;
  animationsEnabled: boolean;
  onAnimationsChange: (enabled: boolean) => void;
  visibleCategories: number;
  onVisibleCategoriesChange: (n: number) => void;
  showLastClueButton: boolean;
  onShowLastClueButtonChange: (visible: boolean) => void;
  playerName: string;
  onNameChange: (name: string) => void;
  relayHost: string;
  onRelayHostChange: (host: string) => void;
  relayPort: string;
  onRelayPortChange: (port: string) => void;
  roomCode?: number | undefined;
}

export function InGameSettingsScreen(props: InGameSettingsScreenProps) {
  const { height } = useWindowDimensions();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeField, setActiveField] = useState<SettingsField | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardMounted, setKeyboardMounted] = useState(false);

  // ── Gradient backdrop (phase 1 / phase 2) ─────────────────────────────────
  const gradientH = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const axisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const dragXValRef = useRef(0);
  const dragYValRef = useRef(0);
  const scrollOffsetRef = useRef(0);

  // ── Keyboard sheet ─────────────────────────────────────────────────────────
  const panelHeight = Math.min(
    SHEET_MAX_HEIGHT,
    Math.max(SHEET_MIN_HEIGHT, Math.round(height * SHEET_HEIGHT_PCT)),
  );
  const kb = useRef(new Animated.Value(0)).current;
  const kbDrag = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView | null>(null);
  const advancedYRef = useRef(0);
  const fieldLayoutRef = useRef<Record<SettingsField, { y: number; height: number }>>({
    playerName: { y: 0, height: 0 },
    relayHost: { y: 0, height: 0 },
    relayPort: { y: 0, height: 0 },
  });

  // ── Open on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    gradientH.setValue(0);
    contentOpacity.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(gradientH, {
        toValue: height,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished) return;
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeSettings = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setKeyboardVisible(false);
    Animated.timing(contentOpacity, {
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
        if (f) props.onClose();
        else closingRef.current = false;
      });
    });
  }, [contentOpacity, gradientH, props]);

  // ── Drag-to-dismiss pan responder ──────────────────────────────────────────
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
      axisRef.current = null;
      dragXValRef.current = 0;
      dragYValRef.current = 0;
      dragX.setValue(0);
      dragY.setValue(0);
    },
    onPanResponderMove: (_e, gesture) => {
      if (!axisRef.current) {
        if (Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
          axisRef.current = 'horizontal';
        } else if (gesture.dy > 0) {
          axisRef.current = 'vertical';
        }
      }
      if (axisRef.current === 'horizontal') {
        dragX.setValue(gesture.dx);
        dragXValRef.current = gesture.dx;
      } else if (axisRef.current === 'vertical') {
        dragYValRef.current = Math.max(0, gesture.dy);
        dragY.setValue(Math.max(0, gesture.dy));
      }
    },
    onPanResponderRelease: (_e, gesture) => {
      const committed =
        (axisRef.current === 'horizontal' && (Math.abs(gesture.dx) > SETTINGS_COMMIT || Math.abs(gesture.vx) > 0.7)) ||
        (axisRef.current === 'vertical' && (gesture.dy > SETTINGS_COMMIT || gesture.vy > 0.7));
      axisRef.current = null;
      dragXValRef.current = 0;
      dragYValRef.current = 0;
      dragX.setValue(0);
      dragY.setValue(0);
      if (committed) closeSettings();
    },
    onPanResponderTerminate: () => {
      axisRef.current = null;
      dragXValRef.current = 0;
      dragYValRef.current = 0;
      dragX.setValue(0);
      dragY.setValue(0);
    },
  }), [closeSettings, dragX, dragY]);

  // Chevron interpolations — mirror LobbyScreen settings panel.
  const leftChevOpacity  = dragX.interpolate({ inputRange: [-SETTINGS_COMMIT, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
  const leftChevTransX   = dragX.interpolate({ inputRange: [-SETTINGS_COMMIT, 0], outputRange: [0, 68], extrapolate: 'clamp' });
  const rightChevOpacity = dragX.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const rightChevTransX  = dragX.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });
  const downChevOpacity  = dragY.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const downChevTransY   = dragY.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });

  // ── Keyboard ───────────────────────────────────────────────────────────────
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
      requestAnimationFrame(() => {
        Animated.spring(kb, {
          toValue: 1,
          speed: 16,
          bounciness: 4,
          useNativeDriver: true,
        }).start();
      });
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
      if (activeField) {
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
        return;
      }
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeField, backspaceChar, closeKeyboard, closeSettings, insertChar]);

  const panelRise = kb.interpolate({
    inputRange: [0, 1],
    outputRange: [panelHeight, 0],
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Phase 1: dark gradient grows upward from the very bottom */}
      <Animated.View
        pointerEvents="none"
        style={[styles.gradientWrap, { height: gradientH }]}
      >
        <LinearGradient
          colors={[colors.backgroundTransparent, colors.background]}
          style={styles.gradientEdge}
          pointerEvents="none"
        />
        <View style={styles.gradientSolid} />
      </Animated.View>

      {/* Phase 2: content fades in */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: contentOpacity }]}
        {...settingsPanResponder.panHandlers}
      >
        {/* Drag handle / tap to close */}
        <Pressable style={styles.dragHandle} onPress={closeSettings}>
          <View style={styles.dragPill} />
        </Pressable>

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

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 32 + (keyboardMounted ? panelHeight : 0) },
          ]}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          bounces={false}
          onScrollBeginDrag={() => { if (keyboardVisible) closeKeyboard(); }}
          onScroll={e => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          onTouchStart={() => { if (keyboardVisible) closeKeyboard(); }}
        >
          <Text style={styles.title}>SETTINGS</Text>

          <Text style={styles.sectionHeading}>Game</Text>

          <Text style={styles.label}>Connection</Text>
          <Text style={styles.detailText}>
            {`${props.relayHost || 'localhost'}:${props.relayPort || '8787'} @ ${props.roomCode ?? '???'}`}
          </Text>

          <Text style={[styles.label, styles.stackedLabel]}>Animations</Text>
          <Pressable
            style={styles.toggleBox}
            onPress={() => props.onAnimationsChange(!props.animationsEnabled)}
          >
            <Text style={[styles.toggleText, !props.animationsEnabled && styles.toggleTextOff]}>
              {props.animationsEnabled ? 'On' : 'Off'}
            </Text>
          </Pressable>

          <Text style={[styles.label, styles.stackedLabel]}>Categories Displayed</Text>
          <View style={styles.catCountRow}>
            {([4, 5, 6] as const).map(n => {
              const active = props.visibleCategories === n;
              return (
                <Pressable
                  key={n}
                  style={[styles.catCountBtn, active && styles.catCountBtnActive]}
                  onPress={() => props.onVisibleCategoriesChange(n)}
                >
                  <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, styles.stackedLabel]}>Last Clue Test Button</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: props.showLastClueButton }}
            style={styles.toggleBox}
            onPress={() => props.onShowLastClueButtonChange(!props.showLastClueButton)}
          >
            <Text style={[styles.toggleText, !props.showLastClueButton && styles.toggleTextOff]}>
              {props.showLastClueButton ? 'Shown' : 'Hidden'}
            </Text>
          </Pressable>

          <Text style={[styles.sectionHeading, styles.stackedSection]}>Player</Text>

          <Text style={styles.label}>Name</Text>
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
            <Text style={[styles.inputText, !props.playerName && styles.inputPlaceholder]}>
              {props.playerName || 'Your name'}
            </Text>
          </Pressable>

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
              style={styles.advancedSection}
              onLayout={event => {
                advancedYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.label}>Relay Host</Text>
              <Pressable
                style={styles.input}
                accessibilityRole="button"
                accessibilityLabel={`Relay host ${props.relayHost || 'empty'}`}
                onLayout={event => {
                  fieldLayoutRef.current.relayHost = {
                    y: advancedYRef.current + event.nativeEvent.layout.y,
                    height: event.nativeEvent.layout.height,
                  };
                }}
                onPress={() => openKeyboard('relayHost')}
              >
                <Text style={[styles.inputText, !props.relayHost && styles.inputPlaceholder]}>
                  {props.relayHost || 'localhost'}
                </Text>
              </Pressable>
              <Text style={[styles.label, styles.stackedLabel]}>Relay Port</Text>
              <Pressable
                style={styles.input}
                accessibilityRole="button"
                accessibilityLabel={`Relay port ${props.relayPort || 'empty'}`}
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
              <Text style={styles.buildTag}>{BUILD_TAG}</Text>
            </View>
          )}

          {/* QUIT GAME */}
          <Pressable
            style={styles.quitBtn}
            onPress={props.onQuit}
            accessibilityRole="button"
            accessibilityLabel="Quit current game"
          >
            <Text style={styles.quitText}>QUIT GAME</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>

      {/* Keyboard sheet */}
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
  // ── Gradient backdrop ────────────────────────────────────────────────────
  gradientWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  gradientEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
  },
  gradientSolid: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  // ── Drag handle ──────────────────────────────────────────────────────────
  dragHandle: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 10,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  // ── Dismiss chevrons (identical to LobbyScreen) ──────────────────────────
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
  // ── Content ──────────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.categoryText,
    textAlign: 'center',
    marginBottom: 24,
  },
  sectionHeading: {
    alignSelf: 'flex-start',
    fontFamily: typeTokens.ui700,
    fontSize: 11,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    width: '100%',
    maxWidth: 400,
  },
  stackedSection: { marginTop: 28 },
  label: {
    alignSelf: 'flex-start',
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
    width: '100%',
    maxWidth: 400,
  },
  stackedLabel: { marginTop: 14 },
  detailText: {
    alignSelf: 'flex-start',
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#555',
    width: '100%',
    maxWidth: 400,
  },
  toggleBox: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
    width: '100%',
    maxWidth: 400,
  },
  toggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
  },
  toggleTextOff: { color: '#666' },
  catCountRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    maxWidth: 400,
  },
  catCountBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  catCountBtnActive: {
    borderColor: '#fff',
    backgroundColor: '#222',
  },
  catCountText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#666',
  },
  catCountTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
    minHeight: 42,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 400,
  },
  inputText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
  },
  inputPlaceholder: { color: '#666' },
  advancedToggle: { marginTop: 24, alignSelf: 'flex-start' },
  advancedToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#555',
  },
  advancedSection: { marginTop: 8, width: '100%', maxWidth: 400 },
  buildTag: {
    marginTop: 8,
    fontFamily: typeTokens.ui500,
    fontSize: 11,
    color: 'rgba(255,255,255,0.16)',
  },
  // ── QUIT GAME ────────────────────────────────────────────────────────────
  quitBtn: {
    marginTop: 48,
    marginBottom: 16,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#5a1a1a',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(180,30,30,0.12)',
  },
  quitText: {
    fontFamily: typeTokens.ui700,
    fontSize: 14,
    letterSpacing: 2,
    color: '#E25550',
  },
  // ── Keyboard sheet ───────────────────────────────────────────────────────
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
