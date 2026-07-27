import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import type { SessionMode } from '../../app/sessionProvider';
import { colors, type as typeTokens } from '../theme/tokens';

const SETTINGS_COMMIT = 60;

interface InGameSettingsScreenProps {
  onClose: () => void;
  onQuit: () => void;
  animationsEnabled: boolean;
  onAnimationsChange: (enabled: boolean) => void;
  vibrationEnabled: boolean;
  onVibrationChange: (enabled: boolean) => void;
  visibleCategories: number;
  onVisibleCategoriesChange: (n: number) => void;
  showLastClueButton: boolean;
  onShowLastClueButtonChange: (visible: boolean) => void;
  /** Kept in interface for compatibility — not rendered. */
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHost?: string;
  onRelayHostChange?: (host: string) => void;
  relayPort?: string;
  onRelayPortChange?: (port: string) => void;
  roomCode?: number | undefined;
  sessionMode?: SessionMode | undefined;
}

export function InGameSettingsScreen(props: InGameSettingsScreenProps) {
  const { height } = useWindowDimensions();

  // ── Gradient backdrop (phase 1 / phase 2) ─────────────────────────────────
  const gradientH = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const axisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const dragXValRef = useRef(0);
  const dragYValRef = useRef(0);

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
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
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

  // Chevron interpolations
  const leftChevOpacity  = dragX.interpolate({ inputRange: [-SETTINGS_COMMIT, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
  const leftChevTransX   = dragX.interpolate({ inputRange: [-SETTINGS_COMMIT, 0], outputRange: [0, 68], extrapolate: 'clamp' });
  const rightChevOpacity = dragX.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const rightChevTransX  = dragX.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });
  const downChevOpacity  = dragY.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const downChevTransY   = dragY.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [closeSettings]);

  // ── Connection info ────────────────────────────────────────────────────────
  const isLocalMode = props.sessionMode === 'bluetooth' || props.sessionMode === 'nearby';
  const connectionLabel = isLocalMode ? 'Bluetooth' : 'Online';

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

        <View style={styles.content}>
          <Text style={styles.title}>SETTINGS</Text>

          <View style={styles.threeCol}>
            {/* ── Left 40%: room summary, with quit anchored at the bottom ── */}
            <View style={styles.mainColLeft}>
              <View style={styles.connectionSummary}>
                <View style={styles.connSubLeft}>
                  <Text style={styles.connSubLabel}>ROOM CODE</Text>
                  <Text style={[styles.connValue, styles.roomCodeValue]}>
                    {props.roomCode ?? '???'}
                  </Text>
                </View>
                <View style={styles.connSubRight}>
                  <Text style={styles.connSubLabel}>CONNECTION</Text>
                  <Text style={styles.connValue}>{connectionLabel}</Text>
                </View>
              </View>

              <Pressable
                style={styles.quitBtn}
                onPress={props.onQuit}
                accessibilityRole="button"
                accessibilityLabel="Quit current game"
              >
                <Text style={styles.quitText}>QUIT GAME</Text>
              </Pressable>
            </View>

            {/* ── Right 60%: game display settings ── */}
            <View style={styles.mainColRight}>
              <View style={styles.settingGroup}>
                <Text style={styles.label}>ANIMATIONS</Text>
                <Pressable
                  style={styles.toggleBox}
                  onPress={() => props.onAnimationsChange(!props.animationsEnabled)}
                >
                  <Text style={[styles.toggleText, !props.animationsEnabled && styles.toggleTextOff]}>
                    {props.animationsEnabled ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.settingGroup}>
                <Text style={styles.label}>CATEGORIES</Text>
                <View style={styles.catCountRow}>
                  {([1, 4, 5, 6] as const).map(n => {
                    const active = props.visibleCategories === n;
                    return (
                      <Pressable
                        key={n}
                        style={styles.catCountBtn}
                        onPress={() => props.onVisibleCategoriesChange(n)}
                      >
                        <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                          {n}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.settingGroup}>
                <Text style={styles.label}>LAST CLUE</Text>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: props.showLastClueButton }}
                  style={styles.toggleBox}
                  onPress={() => props.onShowLastClueButtonChange(!props.showLastClueButton)}
                >
                  <Text style={[styles.toggleText, !props.showLastClueButton && styles.toggleTextOff]}>
                    {props.showLastClueButton ? 'SHOWN' : 'HIDDEN'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* ── Third column: buzz accessibility ─────────────────────── */}
            <View style={styles.mainColBuzz}>
              <View style={styles.settingGroup}>
                <Text style={styles.label}>VIBRATION</Text>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: props.vibrationEnabled }}
                  style={styles.toggleBox}
                  onPress={() => props.onVibrationChange(!props.vibrationEnabled)}
                >
                  <Text style={[styles.toggleText, !props.vibrationEnabled && styles.toggleTextOff]}>
                    {props.vibrationEnabled ? 'ON' : 'OFF'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Animated.View>
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
  // ── Content ──────────────────────────────────────────────────────────────
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
    justifyContent: 'flex-start',
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.categoryText,
    textAlign: 'center',
    marginBottom: 28,
  },
  threeCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 24,
  },
  mainColLeft: {
    flex: 2,
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  mainColRight: {
    flex: 3,
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  mainColBuzz: {
    flex: 1.5,
    paddingBottom: 4,
  },
  settingGroup: {
    minHeight: 58,
  },
  label: {
    fontFamily: typeTokens.ui700,
    fontSize: 10,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  toggleBox: {
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  toggleText: {
    fontFamily: typeTokens.board,
    fontSize: 26,
    color: colors.gold,
  },
  toggleTextOff: {
    color: '#444',
  },
  catCountRow: {
    flexDirection: 'row',
    gap: 14,
    maxWidth: 240,
  },
  catCountBtn: {
    minWidth: 48,
    paddingVertical: 4,
    alignItems: 'center',
  },
  catCountText: {
    fontFamily: typeTokens.board,
    fontSize: 22,
    color: '#444',
  },
  catCountTextActive: {
    color: colors.gold,
  },
  // ── 30 / 70 connection summary ───────────────────────────────────────────
  connectionSummary: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 78,
    paddingVertical: 8,
  },
  connSubLeft: {
    flex: 3,
    justifyContent: 'center',
  },
  connSubRight: {
    flex: 7,
    justifyContent: 'center',
    paddingLeft: 16,
  },
  connSubLabel: {
    fontFamily: typeTokens.ui700,
    fontSize: 9,
    color: '#444',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  connValue: {
    fontFamily: typeTokens.board,
    fontSize: 24,
    color: colors.categoryText,
    textTransform: 'uppercase',
  },
  roomCodeValue: {
    color: colors.categoryText,
    fontSize: 28,
  },
  // ── QUIT GAME ────────────────────────────────────────────────────────────
  quitBtn: {
    paddingVertical: 8,
    marginTop: 24,
    alignItems: 'flex-start',
    alignSelf: 'stretch',
  },
  quitText: {
    fontFamily: typeTokens.board,
    fontSize: 24,
    color: '#C96B68',
  },
});
