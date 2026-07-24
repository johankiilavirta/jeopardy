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
import { relayUrls } from '../../app/relayUrl';
import { DEFAULT_RELAY_HOST } from '../../app/relayDefaults';
import { sanitizeText } from '../../src/sanitizeText';
import { loadGameInfo, loadGameIndex, type GameInfo } from '../../data/gameLoader';
import { nextCompleteGameNumber } from '../../data/gameSelection';
import type { SessionMode } from '../../app/sessionProvider';
import { KeyboardSheet, useKeyboardSheet } from '../components/KeyboardSheet';
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, grid, type as typeTokens } from '../theme/tokens';
import { Board } from '../components/Board';
import { demoBoard, type BoardDefinition } from '../fixtures/board';

export interface LobbyPlayer {
  peerId: string;
  name: string;
  isHost: boolean;
}

interface LobbyScreenProps {
  roomCode: number;
  players: LobbyPlayer[];
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
  onNewGame?: () => void;
  onJoinGame?: () => void;
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHost?: string;
  onRelayHostChange?: (host: string) => void;
  relayPort?: string;
  onRelayPortChange?: (port: string) => void;
  /** Local sessions preview from the bundled archive; online uses the relay. */
  sessionMode?: SessionMode | undefined;
  gameId?: string;
  onGameIdChange?: (id: string) => void;
  buzzerDelay?: string;
  onBuzzerDelayChange?: (delay: string) => void;
  /** Master toggle for in-game animations (default on). */
  animationsEnabled?: boolean;
  onAnimationsChange?: (enabled: boolean) => void;
  /** How many category columns to show (4, 5, or 6). Default 6. */
  visibleCategories?: number | undefined;
  onVisibleCategoriesChange?: ((n: number) => void) | undefined;
  /** Host calls this to remove a player from the lobby. */
  onKickPlayer?: (peerId: string) => void;
  error?: string | null;
  /** The game is ready to mount — fade the lobby out, then hand off. */
  fadeOut?: boolean;
  onFadeOutDone?: () => void;
}

const MAX_PLAYERS = 2;
const EXIT_COMMIT_DISTANCE = 100;
const EXIT_COMMIT_VELOCITY = 0.5;
const START_COMMIT_DISTANCE = 90;
const START_COMMIT_VELOCITY = 0.5;
// Keep the implementation below intact for a future re-enable, but do not
// let the settings panel compete with the GAME # picker for vertical drags.
const ENABLE_SETTINGS_VERTICAL_DISMISS = false;
const EMPTY_BURNED: number[] = [];
const LOBBY_VALUES = [200, 400, 600, 800, 1000] as const;

// ─── Lobby player slot bug ─────────────────────────────────────────────────

interface LobbySlotBugProps {
  player: LobbyPlayer | null;
  slotIndex: number;       // 0 = host slot, 1 = guest slot
  localIsHost: boolean;    // true if the local user is the host
  settingsOpen: boolean;
  onSettings: () => void;
  onKick: () => void;
}

function LobbySlotBug({ player, slotIndex, localIsHost, settingsOpen, onSettings, onKick }: LobbySlotBugProps) {
  const isHostSlot = slotIndex === 0;
  const filled = player != null;
  const nameOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!filled) {
      nameOpacity.setValue(0);
      return;
    }
    // On the host's screen, the arriving guest fades into the existing host
    // bug. The guest's own lobby uses the same instant name handoff as the
    // rest of the join screen.
    if (localIsHost && !isHostSlot) {
      nameOpacity.setValue(0);
      Animated.timing(nameOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      nameOpacity.setValue(1);
    }
  }, [filled, isHostSlot, localIsHost, nameOpacity, player?.peerId]);

  return (
    <View style={bugStyles.bug}>
      {(isHostSlot || filled) && (
        <Text style={[bugStyles.roleLabel, !isHostSlot && bugStyles.roleLabelHidden]} allowFontScaling={false}>
          {isHostSlot ? 'HOST' : ''}
        </Text>
      )}
      {filled && (
        <Animated.Text
          style={[bugStyles.name, { opacity: nameOpacity }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          allowFontScaling={false}
        >
          {player.name.toUpperCase()}
        </Animated.Text>
      )}

      {/* Settings gear — only on host slot, only visible to the host */}
      {isHostSlot && localIsHost && (
        <Pressable
          style={bugStyles.actionBtn}
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="Open game settings"
        >
          <SettingsGlyph />
        </Pressable>
      )}

      {/* Kick button — only on guest slot, only visible to host when slot is filled */}
      {!isHostSlot && localIsHost && filled && (
        <Pressable style={[bugStyles.actionBtn, bugStyles.kickBtn]} onPress={onKick}>
          <Text style={bugStyles.kickText}>KICK</Text>
        </Pressable>
      )}
    </View>
  );
}

const bugStyles = StyleSheet.create({
  bug: {
    flex: 1,
    backgroundColor: colors.cell,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingRight: 44,  // room for action button
    justifyContent: 'center',
    minHeight: 64,
  },
  roleLabel: {
    fontFamily: typeTokens.ui700,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.gold,
    opacity: 0.75,
    marginBottom: 3,
    height: 11,
  },
  roleLabelHidden: {
    opacity: 0,
  },
  name: {
    fontFamily: typeTokens.board,
    fontSize: 22,
    color: colors.categoryText,
    letterSpacing: 0.3,
  },
  nameWaiting: {
    opacity: 0.3,
    fontSize: 14,
    letterSpacing: 1.5,
    fontFamily: typeTokens.ui500,
  },
  actionBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cellRecessed,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontFamily: typeTokens.ui700,
    fontSize: 22,
    lineHeight: 22,
    color: colors.categoryText,
  },
  kickBtn: {
    borderRadius: 16,
    width: 32,
    height: 32,
    paddingHorizontal: 0,
    top: 10,
    right: 10,
  },
  kickText: {
    fontFamily: typeTokens.ui700,
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#E25550',
  },
});

// ─── Settings glyph (3-line equaliser icon) ────────────────────────────────

function SettingsGlyph() {
  return (
    <View style={glyphStyles.wrap}>
      <View style={[glyphStyles.stroke, glyphStyles.strokeTop]} />
      <View style={[glyphStyles.knob, glyphStyles.knobTop]} />
      <View style={[glyphStyles.stroke, glyphStyles.strokeMid]} />
      <View style={[glyphStyles.knob, glyphStyles.knobMid]} />
      <View style={[glyphStyles.stroke, glyphStyles.strokeBot]} />
      <View style={[glyphStyles.knob, glyphStyles.knobBot]} />
    </View>
  );
}

const glyphStyles = StyleSheet.create({
  wrap: { width: 20, height: 18 },
  stroke: {
    position: 'absolute',
    left: 1,
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.categoryText,
  },
  knob: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: colors.categoryText,
    backgroundColor: colors.cellRecessed,
  },
  strokeTop: { top: 1 },
  strokeMid: { top: 8 },
  strokeBot: { top: 15 },
  knobTop:  { top: -1, left: 4 },
  knobMid:  { top: 6,  right: 3 },
  knobBot:  { top: 13, left: 7 },
});

// ─── Main lobby screen ─────────────────────────────────────────────────────

export function LobbyScreen(props: LobbyScreenProps) {
  const { width, height } = useWindowDimensions();
  const canStart = props.isHost && props.players.length >= MAX_PLAYERS;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRound1, setShowRound1] = useState(false);
  const [showRound2, setShowRound2] = useState(false);
  const [round1Categories, setRound1Categories] = useState<{ name: string; clueCount: number }[] | null>(null);
  const [round2Categories, setRound2Categories] = useState<{ name: string; clueCount: number }[] | null>(null);
  const [airDate, setAirDate] = useState<string | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [gameInfoStatus, setGameInfoStatus] = useState<'idle' | 'loading' | 'not-found'>('idle');

  const contentOpacity = useRef(new Animated.Value(1)).current;
  const codeVisible = useRef(new Animated.Value(0)).current;
  const setupScrollRef = useRef<ScrollView | null>(null);
  const advancedYRef = useRef(0);
  const gameIdLayoutRef = useRef({ y: 0, height: 0 });
  const gameIdSwipeStartRef = useRef(0);
  const gameIdSwipeActiveRef = useRef(false);
  const completeGameCacheRef = useRef(new Map<number, GameInfo | null>());
  const fadeStartedRef = useRef(false);
  const pageX = useRef(new Animated.Value(0)).current;
  const gestureAxisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const dragXRef = useRef(0);
  const dragYRef = useRef(0);
  const leavingRef = useRef(false);
  const startRequestedRef = useRef(false);

  // Settings: phase-1 = gradient grows from bottom; phase-2 = content fades in.
  const categoriesVisible = useRef(new Animated.Value(0)).current;
  const gradientH = useRef(new Animated.Value(0)).current;
  const settingsContentOpacity = useRef(new Animated.Value(0)).current;
  const settingsDragX = useRef(new Animated.Value(0)).current;
  const settingsDragY = useRef(new Animated.Value(0)).current;
  const settingsDragYRef = useRef(0);
  const settingsAxisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const settingsScrollOffsetRef = useRef(0);
  const settingsClosingRef = useRef(false);
  const [settingsContentH, setSettingsContentH] = useState(0);
  const [settingsScrollH, setSettingsScrollH] = useState(0);
  const [gameIdGestureActive, setGameIdGestureActive] = useState(false);
  const [buzzerDelayGestureActive, setBuzzerDelayGestureActive] = useState(false);
  const buzzerDelayStartRef = useRef(-1);
  const buzzerDelayValueRef = useRef(props.buzzerDelay ?? '-1');
  buzzerDelayValueRef.current = props.buzzerDelay ?? '-1';
  const buzzerDelayChangeRef = useRef(props.onBuzzerDelayChange);
  buzzerDelayChangeRef.current = props.onBuzzerDelayChange;
  const buzzerDelaySwipeActiveRef = useRef(false);
  const [keyboardField, setKeyboardField] = useState<'gameId' | 'buzzerDelay'>('gameId');
  const keyboardFieldRef = useRef<'gameId' | 'buzzerDelay'>('gameId');
  const buzzerDelayLayoutRef = useRef({ y: 0, height: 0 });
  const gameIdTouchReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameIdValueRef = useRef(props.gameId);
  gameIdValueRef.current = props.gameId;
  const gameIdChangeRef = useRef(props.onGameIdChange);
  gameIdChangeRef.current = props.onGameIdChange;

  const beginGameIdTouch = useCallback(() => {
    if (gameIdTouchReleaseTimerRef.current) {
      clearTimeout(gameIdTouchReleaseTimerRef.current);
      gameIdTouchReleaseTimerRef.current = null;
    }
    setGameIdGestureActive(true);
  }, []);

  const endGameIdTouch = useCallback(() => {
    if (gameIdTouchReleaseTimerRef.current) clearTimeout(gameIdTouchReleaseTimerRef.current);
    // Keep the ScrollView locked through the responder handoff and Pressable
    // release so it cannot steal the tail of a vertical picker gesture.
    gameIdTouchReleaseTimerRef.current = setTimeout(() => {
      gameIdTouchReleaseTimerRef.current = null;
      setGameIdGestureActive(false);
    }, 120);
  }, []);

  // ── Keyboard sheet for game # entry ──────────────────────────────────────

  const sheet = useKeyboardSheet(
    () => {
      const layout = keyboardFieldRef.current === 'buzzerDelay'
        ? buzzerDelayLayoutRef.current
        : gameIdLayoutRef.current;
      if (!layout.height) return;
      const keyboardTop = height - sheet.panelHeight;
      const targetTop = (keyboardTop - layout.height) / 2;
      const y = Math.max(0, layout.y - targetTop);
      requestAnimationFrame(() => {
        setupScrollRef.current?.scrollTo({ y, animated: true });
      });
    },
    () => setKeyboardField('gameId'),
  );

  const insertGameIdDigit = useCallback((digit: string) => {
    if (keyboardFieldRef.current === 'buzzerDelay') {
      const current = !props.buzzerDelay || Number(props.buzzerDelay) < 0 ? '' : props.buzzerDelay;
      if (digit === '.' && current.includes('.')) return;
      props.onBuzzerDelayChange?.(`${current}${digit}`.replace(/[^0-9.]/g, ''));
      return;
    }
    props.onGameIdChange?.(`${props.gameId ?? ''}${digit}`.replace(/\D/g, '').slice(0, 6));
  }, [props]);

  const backspaceGameId = useCallback(() => {
    if (keyboardFieldRef.current === 'buzzerDelay') {
      const current = !props.buzzerDelay || Number(props.buzzerDelay) < 0 ? '' : props.buzzerDelay;
      props.onBuzzerDelayChange?.(current.slice(0, -1) || '-1');
      return;
    }
    props.onGameIdChange?.((props.gameId ?? '').slice(0, -1));
  }, [props]);

  const getCachedGameInfo = useCallback((gameNumber: number) => {
    const cached = completeGameCacheRef.current;
    if (cached.has(gameNumber)) return cached.get(gameNumber) ?? null;
    const info = loadGameInfo(gameNumber);
    cached.set(gameNumber, info);
    return info;
  }, []);

  const updateGameIdFromSwipe = useCallback((dy: number, vy: number) => {
    const start = gameIdSwipeStartRef.current;
    const direction: -1 | 1 = dy < 0 ? 1 : -1;
    // Distance gives deliberate steps; velocity adds momentum while the
    // finger is still down, so a faster swipe visibly advances faster.
    const distanceSteps = Math.floor(Math.abs(dy) / 28);
    // PanResponder velocities are expressed in roughly px/ms (the same
    // scale used by the sheet's 0.7 swipe threshold). A quick flick therefore
    // adds several valid-game steps while a slow drag stays distance-driven.
    const momentumSteps = Math.floor(Math.abs(vy) * 4);
    const steps = Math.max(1, distanceSteps + momentumSteps);
    const next = nextCompleteGameNumber(
      start,
      direction,
      steps,
      loadGameIndex().totalGames,
      getCachedGameInfo,
    );
    if (String(next) !== gameIdValueRef.current) gameIdChangeRef.current?.(String(next));
  }, [getCachedGameInfo]);

  const gameIdResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35,
    onPanResponderGrant: () => {
      beginGameIdTouch();
      const current = Number(gameIdValueRef.current);
      gameIdSwipeStartRef.current = Number.isFinite(current) && current > 0
        ? current
        : fallbackGameId.current;
      gameIdSwipeActiveRef.current = false;
    },
    onPanResponderMove: (_event, gesture) => {
      gameIdSwipeActiveRef.current = true;
      updateGameIdFromSwipe(gesture.dy, gesture.vy);
    },
    onPanResponderRelease: () => {
      // Let a Pressable release that follows this responder event know that
      // it was a swipe, not a tap. Clear shortly afterward for the next tap.
      gameIdSwipeActiveRef.current = true;
      endGameIdTouch();
      setTimeout(() => { gameIdSwipeActiveRef.current = false; }, 100);
    },
    onPanResponderTerminate: () => {
      gameIdSwipeActiveRef.current = true;
      endGameIdTouch();
      setTimeout(() => { gameIdSwipeActiveRef.current = false; }, 100);
    },
  }), [beginGameIdTouch, endGameIdTouch, updateGameIdFromSwipe]);

  const buzzerDelayResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35,
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35,
    onPanResponderGrant: () => {
      setBuzzerDelayGestureActive(true);
      const current = Number(buzzerDelayValueRef.current);
      buzzerDelayStartRef.current = Number.isFinite(current) && current >= -1 ? current : -1;
    },
    onPanResponderMove: (_event, gesture) => {
      buzzerDelaySwipeActiveRef.current = true;
      const start = buzzerDelayStartRef.current;
      const direction = gesture.dy < 0 ? 1 : -1;
      const steps = Math.max(1, Math.floor(Math.abs(gesture.dy) / 28));
      const next = start < 0
        ? (direction > 0 ? 0 : -1)
        : start === 0 && direction < 0
          ? -1
          : Math.max(0, Math.round((start + direction * steps * 0.5) * 2) / 2);
      buzzerDelayChangeRef.current?.(String(next));
    },
    onPanResponderRelease: () => {
      buzzerDelaySwipeActiveRef.current = true;
      setBuzzerDelayGestureActive(false);
      setTimeout(() => { buzzerDelaySwipeActiveRef.current = false; }, 100);
    },
    onPanResponderTerminate: () => {
      buzzerDelaySwipeActiveRef.current = true;
      setBuzzerDelayGestureActive(false);
      setTimeout(() => { buzzerDelaySwipeActiveRef.current = false; }, 100);
    },
  }), []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (!sheet.visible) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        insertGameIdDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspaceGameId();
      } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        sheet.close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [backspaceGameId, sheet, insertGameIdDigit]);

  // ── Fade out when game starts ─────────────────────────────────────────────

  useEffect(() => {
    if (!props.fadeOut || fadeStartedRef.current) return;
    fadeStartedRef.current = true;
    if (props.animationsEnabled === false) {
      props.onFadeOutDone?.();
      return;
    }
    Animated.timing(contentOpacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => props.onFadeOutDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fadeOut]);

  // ── Room code fade-in ─────────────────────────────────────────────────────
  // Code block (number + share label) is invisible until the relay assigns a
  // room code, then fades in so the black-overlay reveal looks clean.

  useEffect(() => {
    if (props.roomCode <= 0) return;
    Animated.timing(codeVisible, {
      toValue: 1,
      duration: 350,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [props.roomCode, codeVisible]);

  // ── Game info loading ─────────────────────────────────────────────────────

  // Stable random game number ≥ 7500 used when no specific game is chosen.
  // Picked once on mount so the board doesn't re-randomise on every render.
  const fallbackGameId = useRef<number>(0);
  const randomGameAssignedRef = useRef(false);
  if (fallbackGameId.current === 0) {
    const index = loadGameIndex();
    const min = 7500;
    const max = index.totalGames;
    fallbackGameId.current = min + Math.floor(Math.random() * (max - min + 1));
  }

  // Resolve the random choice once for the host. Keeping it in the shared
  // gameId state makes the number visible in settings and ensures START uses
  // the same game that the lobby preview loaded.
  useEffect(() => {
    if (!props.isHost || props.gameId || randomGameAssignedRef.current) return;
    randomGameAssignedRef.current = true;
    props.onGameIdChange?.(String(fallbackGameId.current));
  }, [props.gameId, props.isHost, props.onGameIdChange]);

  useEffect(() => {
    const id = props.gameId;
    // When no specific game is set, use the fallback random id for the board backdrop.
    const resolvedId = (!id || !/^\d+$/.test(id) || Number(id) < 1)
      ? String(fallbackGameId.current)
      : id;

    if (resolvedId !== id) {
      // Random/blank game — load locally for backdrop display only, no status feedback
      const info = loadGameInfo(Number(resolvedId));
      if (info) {
        setRound1Categories(info.round1 ?? null);
        setRound2Categories(info.round2 ?? null);
        setAirDate(info.airDate ?? null);
        setSeasonNumber(info.season ?? null);
      } else {
        setRound1Categories(null);
        setRound2Categories(null);
        setAirDate(null);
        setSeasonNumber(null);
      }
      setGameInfoStatus('idle');
      return;
    }
    setGameInfoStatus('loading');
    const timer = setTimeout(async () => {
      const applyInfo = (data: GameInfo) => {
        setRound1Categories(data.round1?.map(category => ({
          ...category,
          name: sanitizeText(category.name),
        })) ?? null);
        setRound2Categories(data.round2?.map(category => ({
          ...category,
          name: sanitizeText(category.name),
        })) ?? null);
        setAirDate(data.airDate ?? null);
        setSeasonNumber(data.season ?? null);
        setGameInfoStatus(data.round1 ? 'idle' : 'not-found');
      };

      if (props.sessionMode === 'bluetooth' || props.sessionMode === 'nearby') {
        const info = loadGameInfo(Number(id));
        if (info) applyInfo(info);
        else {
          setRound1Categories(null); setRound2Categories(null);
          setAirDate(null); setSeasonNumber(null);
          setGameInfoStatus('not-found');
        }
        return;
      }

      try {
        const base = relayUrls(props.relayHost ?? DEFAULT_RELAY_HOST, props.relayPort ?? '8787').http;
        const res = await fetch(`${base}/game-info/${id}`);
        if (!res.ok) {
          setRound1Categories(null); setRound2Categories(null);
          setAirDate(null); setSeasonNumber(null);
          setGameInfoStatus('not-found'); return;
        }
        applyInfo(await res.json() as GameInfo);
      } catch {
        setRound1Categories(null); setRound2Categories(null);
        setAirDate(null); setSeasonNumber(null);
        setGameInfoStatus('not-found');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [props.gameId, props.relayHost, props.relayPort, props.sessionMode]);

  // ── Board backdrop ────────────────────────────────────────────────────────

  const realBoard = useMemo((): BoardDefinition | null => {
    if (!round1Categories || round1Categories.length === 0) return null;
    const count = Math.min(round1Categories.length, props.visibleCategories ?? 6);
    return {
      categories: round1Categories.slice(0, count).map((cat, col) => {
        // Append * (1 missing) or *N (N > 1 missing) to category name.
        const missing = Math.max(0, 5 - cat.clueCount);
        const suffix = missing === 0 ? '' : missing === 1 ? '*' : `*${missing}`;
        return {
          name: cat.name + suffix,
          clues: LOBBY_VALUES.map((value, row) => ({
            id: col * 5 + row,
            value,
          })),
        };
      }),
    };
  }, [round1Categories, props.visibleCategories]);

  // lobbyBoard is used by the overlay and column-count logic; falls back to demoBoard.
  const lobbyBoard = realBoard ?? demoBoard;

  // Fade real board in when categories load, reset when they clear.
  useEffect(() => {
    if (!realBoard) {
      categoriesVisible.setValue(0);
      return;
    }
    Animated.timing(categoriesVisible, {
      toValue: 1,
      duration: 350,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [realBoard, categoriesVisible]);

  // ── R1/R2 category toggle ─────────────────────────────────────────────────
  // Tapping a category header fades in the Double Jeopardy category name.

  const catAnimsRef = useRef<Animated.Value[]>([]);
  const toggledColsRef = useRef<Set<number>>(new Set());

  // Keep per-column anims array in sync with column count.
  const colCount = lobbyBoard.categories.length;
  if (catAnimsRef.current.length !== colCount) {
    catAnimsRef.current = Array.from({ length: colCount }, (_, i) =>
      catAnimsRef.current[i] ?? new Animated.Value(0),
    );
  }

  // Reset toggles whenever a new game is loaded.
  useEffect(() => {
    toggledColsRef.current = new Set();
    catAnimsRef.current.forEach(a => a.setValue(0));
  }, [round1Categories]);

  const handleCategoryPress = useCallback((col: number) => {
    if (!round2Categories || !round2Categories[col]) return;
    const nowOn = !toggledColsRef.current.has(col);
    if (nowOn) toggledColsRef.current.add(col);
    else toggledColsRef.current.delete(col);
    const anim = catAnimsRef.current[col];
    if (anim) {
      Animated.timing(anim, {
        toValue: nowOn ? 1 : 0,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [round2Categories]);

  // ── Sorted player slots (host always first) ───────────────────────────────

  const sortedSlots = useMemo((): (LobbyPlayer | null)[] => {
    const hostPlayer = props.players.find(p => p.isHost)
      // Pre-populate with local name so the bug never shows WAITING→name flash.
      ?? (props.isHost && props.playerName
        ? { peerId: 'local-host', name: props.playerName, isHost: true }
        : null);
    const guestPlayer = props.players.find(p => !p.isHost) ?? null;
    return [hostPlayer, guestPlayer];
  }, [props.players, props.isHost, props.playerName]);

  // ── Gesture handling ──────────────────────────────────────────────────────

  const returnGestureToRest = useCallback(() => {
    gestureAxisRef.current = null;
    dragXRef.current = 0;
    dragYRef.current = 0;
    Animated.spring(pageX, {
      toValue: 0,
      speed: 18,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  }, [pageX]);

  const openSettings = useCallback(() => {
    sheet.close();
    settingsClosingRef.current = false;
    gradientH.setValue(0);
    settingsContentOpacity.setValue(0);
    setShowAdvanced(true);
    // Phase 1: gradient grows from bottom to cover full screen.
    Animated.timing(gradientH, {
      toValue: height,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      // Phase 2: settings content fades in.
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
    // Phase 1: fade out content.
    Animated.timing(settingsContentOpacity, {
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      // Phase 2: gradient shrinks back down.
      Animated.timing(gradientH, {
        toValue: 0,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }).start(({ finished: f }) => {
        if (f) setShowAdvanced(false);
        else settingsClosingRef.current = false;
      });
    });
  }, [gradientH, settingsContentOpacity, sheet]);

  const leaveLobby = useCallback((_direction: -1 | 1) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    // Page stays put; parent fades to black then transitions to menu.
    props.onLeave();
  }, [props]);

  const requestStart = useCallback(() => {
    if (!canStart || startRequestedRef.current) return;
    startRequestedRef.current = true;
    props.onStart();
    setTimeout(() => {
      startRequestedRef.current = false;
    }, 1000);
  }, [canStart, props.onStart]);

  const lobbyPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => {
      if (showAdvanced || leavingRef.current || startRequestedRef.current) return false;
      const horizontal =
        Math.abs(gesture.dx) > 12 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35;
      const verticalStart =
        canStart &&
        gesture.dy < -12 &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.35;
      return horizontal || verticalStart;
    },
    onPanResponderGrant: () => {
      gestureAxisRef.current = null;
      dragXRef.current = 0;
      dragYRef.current = 0;
    },
    onPanResponderMove: (_event, gesture) => {
      if (!gestureAxisRef.current) {
        gestureAxisRef.current =
          Math.abs(gesture.dx) > Math.abs(gesture.dy) ? 'horizontal' : 'vertical';
      }
      if (gestureAxisRef.current === 'horizontal') {
        const sign = gesture.dx < 0 ? -1 : 1;
        const distance = Math.abs(gesture.dx);
        const resisted =
          distance <= EXIT_COMMIT_DISTANCE
            ? distance
            : EXIT_COMMIT_DISTANCE + (distance - EXIT_COMMIT_DISTANCE) * 0.18;
        dragXRef.current = sign * resisted;
        pageX.setValue(sign * resisted);
        return;
      }
      const distance = Math.abs(Math.min(0, gesture.dy));
      const resisted =
        distance <= START_COMMIT_DISTANCE
          ? distance
          : START_COMMIT_DISTANCE + (distance - START_COMMIT_DISTANCE) * 0.18;
      dragYRef.current = -resisted;
    },
    onPanResponderRelease: (_event, gesture) => {
      if (gestureAxisRef.current === 'horizontal') {
        const committed =
          Math.abs(dragXRef.current) >= EXIT_COMMIT_DISTANCE ||
          (
            Math.abs(dragXRef.current) >= 45 &&
            Math.abs(gesture.vx) >= EXIT_COMMIT_VELOCITY
          );
        if (committed) {
          leaveLobby(dragXRef.current < 0 ? -1 : 1);
          return;
        }
      } else if (gestureAxisRef.current === 'vertical') {
        const committed =
          -dragYRef.current >= START_COMMIT_DISTANCE ||
          (-dragYRef.current >= 40 && -gesture.vy >= START_COMMIT_VELOCITY);
        if (committed) requestStart();
      }
      returnGestureToRest();
    },
    onPanResponderTerminate: returnGestureToRest,
  });

  // ── Render ────────────────────────────────────────────────────────────────

  // Gradient: split between original and previous tweak for balance.
  const gradientLocations: [number, number] = [0.10, 0.47];

  // Chevron icons — mirror JoinGameScreen exactly:
  // drag LEFT  → right-side ">" icon slides in from the right
  // drag RIGHT → left-side  "<" icon slides in from the left
  const dragLeftChevronOpacity = pageX.interpolate({
    inputRange: [-EXIT_COMMIT_DISTANCE, -20, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });
  const dragLeftChevronTranslateX = pageX.interpolate({
    inputRange: [-EXIT_COMMIT_DISTANCE, 0],
    outputRange: [0, 68],
    extrapolate: 'clamp',
  });
  const dragRightChevronOpacity = pageX.interpolate({
    inputRange: [0, 20, EXIT_COMMIT_DISTANCE],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });
  const dragRightChevronTranslateX = pageX.interpolate({
    inputRange: [0, EXIT_COMMIT_DISTANCE],
    outputRange: [-68, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root} {...lobbyPanResponder.panHandlers}>
      <Animated.View style={styles.page}>

        {/* 1. Game board as non-interactive backdrop */}
        <View style={styles.boardBackdrop} pointerEvents="none">
          {/* Blank board (no category names) always visible as base layer */}
          <Board
            board={{ categories: demoBoard.categories.map(c => ({ ...c, name: '' })) }}
            burnedClueIds={EMPTY_BURNED}
            locked={true}
          />
          {/* Real categories fade in on top once loaded */}
          {realBoard && (
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: categoriesVisible }]}>
              <Board board={realBoard} burnedClueIds={EMPTY_BURNED} locked={true} />
            </Animated.View>
          )}
        </View>

        {/* 1b. Clickable category-toggle overlay (positioned over the board's category header row) */}
        {round2Categories && (() => {
          // Reproduce Board's flex layout to find the category row bounds.
          const totalFlexH = 6.25; // 1.25 cat + 5 clue rows
          const totalGapH = 5 * grid.lineWidth;
          const catRowH = (height - totalGapH) * 1.25 / totalFlexH;
          const colGap = grid.lineWidth;
          const colW = (width - (colCount - 1) * colGap) / colCount;
          return (
            <View
              style={[styles.catOverlayRow, { height: catRowH }]}
              pointerEvents="box-none"
            >
              {lobbyBoard.categories.map((cat, col) => {
                const r2Cat = round2Categories[col];
                if (!r2Cat) return null;
                const r2Missing = Math.max(0, 5 - r2Cat.clueCount);
                const r2Suffix = r2Missing === 0 ? '' : r2Missing === 1 ? '*' : `*${r2Missing}`;
                const r2Name = (r2Cat.name + r2Suffix).toUpperCase();
                const anim = catAnimsRef.current[col];
                if (!anim) return null;
                return (
                  <Pressable
                    key={col}
                    style={[styles.catOverlayCol, { width: colW, left: col * (colW + colGap) }]}
                    onPress={() => handleCategoryPress(col)}
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle Double Jeopardy category: ${r2Name}`}
                  >
                    {/* R2 name fades in over the R1 name when toggled */}
                    <Animated.View
                      style={[StyleSheet.absoluteFill, styles.catOverlayPanel, { opacity: anim }]}
                      pointerEvents="none"
                    >
                      <Text
                        style={styles.catOverlayText}
                        numberOfLines={3}
                        adjustsFontSizeToFit
                        minimumFontScale={0.2}
                        allowFontScaling={false}
                      >
                        {r2Name}
                      </Text>
                    </Animated.View>
                  </Pressable>
                );
              })}
            </View>
          );
        })()}

        {/* 2. Gradient: fades board into the background colour */}
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', colors.bg]}
          locations={gradientLocations}
          style={styles.boardGradient}
        />

        {/* 3. Interactive content layer */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.contentLayer, { opacity: contentOpacity }]}
        >

          {/* Bottom section: lobby code above, player bugs at the very bottom */}
          <View style={styles.bottomSection}>
            <Animated.View style={[styles.codeBlock, { opacity: codeVisible }]}>
              <Text style={styles.codeValue} allowFontScaling={false}>
                {props.roomCode > 0 ? props.roomCode : ''}
              </Text>
              <Text style={styles.codeLabel} allowFontScaling={false} numberOfLines={1}>
                {'SHARE THIS ' + (props.sessionMode ?? 'ONLINE').toUpperCase() + ' ROOM CODE'}
              </Text>
            </Animated.View>

            <View style={styles.playerRow}>
              {sortedSlots.map((player, i) => (
                <LobbySlotBug
                  key={player?.peerId ?? `slot-${i}`}
                  player={player}
                  slotIndex={i}
                  localIsHost={props.isHost}
                  settingsOpen={showAdvanced}
                  onSettings={() => { if (showAdvanced) closeSettings(); else openSettings(); }}
                  onKick={() => { if (player) props.onKickPlayer?.(player.peerId); }}
                />
              ))}
            </View>
          </View>

          {/* Settings panel — phase 1: gradient grows from bottom; phase 2: content fades in */}
          {props.isHost && showAdvanced && (() => {
            const SETTINGS_COMMIT = 60;
            const settingsPanResponder = PanResponder.create({
              onMoveShouldSetPanResponder: (_e, gesture) => {
                const isDown =
                  ENABLE_SETTINGS_VERTICAL_DISMISS &&
                  gesture.dy > 10 &&
                  Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5 &&
                  settingsScrollOffsetRef.current <= 0;
                const isHorizontal =
                  Math.abs(gesture.dx) > 10 &&
                  Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
                return isDown || isHorizontal;
              },
              onPanResponderGrant: () => {
                settingsAxisRef.current = null;
                settingsDragYRef.current = 0;
                settingsDragX.setValue(0);
                settingsDragY.setValue(0);
              },
              onPanResponderMove: (_e, gesture) => {
                if (!settingsAxisRef.current) {
                  if (Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
                    settingsAxisRef.current = 'horizontal';
                  } else if (ENABLE_SETTINGS_VERTICAL_DISMISS && gesture.dy > 0) {
                    settingsAxisRef.current = 'vertical';
                  }
                }
                if (settingsAxisRef.current === 'horizontal') {
                  settingsDragX.setValue(gesture.dx);
                } else if (ENABLE_SETTINGS_VERTICAL_DISMISS && settingsAxisRef.current === 'vertical') {
                  settingsDragYRef.current = Math.max(0, gesture.dy);
                  settingsDragY.setValue(Math.max(0, gesture.dy));
                }
              },
              onPanResponderRelease: (_e, gesture) => {
                const committed =
                  (settingsAxisRef.current === 'horizontal' && (Math.abs(gesture.dx) > SETTINGS_COMMIT || Math.abs(gesture.vx) > 0.7)) ||
                  (ENABLE_SETTINGS_VERTICAL_DISMISS && settingsAxisRef.current === 'vertical' && (gesture.dy > SETTINGS_COMMIT || gesture.vy > 0.7));
                settingsAxisRef.current = null;
                settingsDragYRef.current = 0;
                settingsDragX.setValue(0);
                settingsDragY.setValue(0);
                if (committed) closeSettings();
              },
              onPanResponderTerminate: () => {
                settingsAxisRef.current = null;
                settingsDragYRef.current = 0;
                settingsDragX.setValue(0);
                settingsDragY.setValue(0);
              },
            });

            // Chevron interpolations — mirror lobby pattern exactly.
            // Drag LEFT  → right-side ">" chevron slides in from the right
            const settingsLeftDragChevOpacity = settingsDragX.interpolate({ inputRange: [-SETTINGS_COMMIT, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
            const settingsLeftDragChevTransX = settingsDragX.interpolate({ inputRange: [-SETTINGS_COMMIT, 0], outputRange: [0, 68], extrapolate: 'clamp' });
            // Drag RIGHT → left-side  "<" chevron slides in from the left
            const settingsRightDragChevOpacity = settingsDragX.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
            const settingsRightDragChevTransX = settingsDragX.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });
            // Drag DOWN  → top-centre "v" chevron follows the finger down
            const settingsDownChevOpacity = settingsDragY.interpolate({ inputRange: [0, 20, SETTINGS_COMMIT], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
            const settingsDownChevTransY = settingsDragY.interpolate({ inputRange: [0, SETTINGS_COMMIT], outputRange: [-68, 0], extrapolate: 'clamp' });
            return (
              <View style={StyleSheet.absoluteFill} {...settingsPanResponder.panHandlers}>
                {/* Phase 1: dark gradient grows upward from the very bottom */}
                <Animated.View
                  pointerEvents="none"
                  style={[styles.settingsGradientWrap, { height: gradientH }]}
                >
                  {/* Soft fade at the leading (top) edge */}
                  <LinearGradient
                    colors={['transparent', colors.bg]}
                    style={styles.settingsGradientEdge}
                    pointerEvents="none"
                  />
                  {/* Solid fill behind the fade so the screen is fully covered */}
                  <View style={styles.settingsGradientSolid} />
                </Animated.View>

                {/* Phase 2: content fades in once gradient covers screen */}
                <Animated.View
                  style={[StyleSheet.absoluteFill, { opacity: settingsContentOpacity }]}
                >
                  {/* Drag handle / tap to close */}
                  <Pressable style={styles.settingsDragHandle} onPress={closeSettings}>
                    <View style={styles.settingsDragPill} />
                  </Pressable>

                {/* Drag-left → right-side ">" chevron */}
                <Animated.View pointerEvents="none" style={[styles.exitIcon, styles.exitIconRight, { opacity: settingsLeftDragChevOpacity, transform: [{ translateX: settingsLeftDragChevTransX }] }]}>
                  <View style={styles.chevron}>
                    <View style={[styles.chevronStroke, styles.chevronTop]} />
                    <View style={[styles.chevronStroke, styles.chevronBottom]} />
                  </View>
                </Animated.View>
                {/* Drag-right → left-side "<" chevron */}
                <Animated.View pointerEvents="none" style={[styles.exitIcon, styles.exitIconLeft, { opacity: settingsRightDragChevOpacity, transform: [{ translateX: settingsRightDragChevTransX }] }]}>
                  <View style={[styles.chevron, styles.chevronFlipped]}>
                    <View style={[styles.chevronStroke, styles.chevronTop]} />
                    <View style={[styles.chevronStroke, styles.chevronBottom]} />
                  </View>
                </Animated.View>
                {/* Drag-down → top-centre "v" chevron */}
                <Animated.View pointerEvents="none" style={[styles.exitIconTop, { opacity: settingsDownChevOpacity, transform: [{ translateY: settingsDownChevTransY }] }]}>
                  <View style={[styles.chevron, styles.chevronDown]}>
                    <View style={[styles.chevronStroke, styles.chevronTop]} />
                    <View style={[styles.chevronStroke, styles.chevronBottom]} />
                  </View>
                </Animated.View>

                <ScrollView
                  ref={setupScrollRef}
                  style={styles.settingsScroll}
                  contentContainerStyle={[
                    styles.settingsScrollContent,
                    { paddingBottom: 32 + (sheet.visible ? sheet.panelHeight : 0) },
                  ]}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={settingsContentH > settingsScrollH && !gameIdGestureActive && !buzzerDelayGestureActive}
                  scrollEventThrottle={16}
                  bounces={false}
                  onLayout={e => setSettingsScrollH(e.nativeEvent.layout.height)}
                  onContentSizeChange={(_w, h) => setSettingsContentH(h)}
                  onScroll={e => {
                    settingsScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
                  }}
                >
                  <View
                    style={styles.advancedSection}
                    onLayout={event => {
                      advancedYRef.current = event.nativeEvent.layout.y;
                    }}
                  >
                    <Text style={styles.gameSettingsTitle}>GAME SETTINGS</Text>

                    <View style={styles.settingsTwoCol}>
                      {/* ── Left column: quick toggles ── */}
                      <View style={styles.settingsColLeft}>
                        <Text style={styles.label}>ANIMATIONS</Text>
                        <Pressable
                          style={styles.toggleBox}
                          onPress={() =>
                            props.onAnimationsChange?.(!(props.animationsEnabled ?? true))
                          }
                        >
                          <Text
                            style={[
                              styles.toggleText,
                              !(props.animationsEnabled ?? true) && styles.toggleTextOff,
                            ]}
                          >
                            {(props.animationsEnabled ?? true) ? 'ON' : 'OFF'}
                          </Text>
                        </Pressable>

                        <Text style={[styles.label, styles.stackedLabel]}>CATEGORIES</Text>
                        <View style={styles.catCountRow}>
                          {([4, 5, 6] as const).map(n => {
                            const active = (props.visibleCategories ?? 6) === n;
                            return (
                              <Pressable
                                key={n}
                                style={styles.catCountBtn}
                                onPress={() => props.onVisibleCategoriesChange?.(n)}
                              >
                                <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                                  {n}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={[styles.label, styles.stackedLabel]}>BUZZER DELAY</Text>
                        <View
                          style={styles.buzzerDelayTouchArea}
                          {...buzzerDelayResponder.panHandlers}
                          onTouchStart={() => setBuzzerDelayGestureActive(true)}
                          onTouchEnd={() => setBuzzerDelayGestureActive(false)}
                          onTouchCancel={() => setBuzzerDelayGestureActive(false)}
                        >
                          <Pressable
                            style={styles.buzzerDelayInput}
                            accessibilityRole="button"
                            accessibilityLabel={`Buzzer delay ${Number(props.buzzerDelay) < 0 || !props.buzzerDelay ? 'default' : props.buzzerDelay}`}
                            onLayout={event => {
                              buzzerDelayLayoutRef.current = {
                                y: advancedYRef.current + event.nativeEvent.layout.y,
                                height: event.nativeEvent.layout.height,
                              };
                            }}
                            onPress={() => {
                              if (buzzerDelaySwipeActiveRef.current) {
                                buzzerDelaySwipeActiveRef.current = false;
                                return;
                              }
                              keyboardFieldRef.current = 'buzzerDelay';
                              setKeyboardField('buzzerDelay');
                              sheet.open();
                            }}
                          >
                            <Text style={styles.buzzerDelayText}>
                              {!props.buzzerDelay || Number(props.buzzerDelay) < 0 ? 'DEFAULT' : props.buzzerDelay}
                            </Text>
                          </Pressable>
                        </View>
                      </View>

                      {/* ── Right column: game selection ── */}
                      <View style={styles.settingsColRight}>
                        <Text style={styles.label}>GAME #</Text>
                        <View
                          style={styles.gameIdPickerTouchArea}
                          {...gameIdResponder.panHandlers}
                          onTouchStart={beginGameIdTouch}
                          onTouchEnd={endGameIdTouch}
                          onTouchCancel={endGameIdTouch}
                        >
                          <Pressable
                          style={styles.input}
                          accessibilityRole="button"
                          accessibilityLabel={`Game number ${props.gameId || 'random'}`}
                          onLayout={event => {
                            gameIdLayoutRef.current = {
                              y: advancedYRef.current + event.nativeEvent.layout.y,
                              height: event.nativeEvent.layout.height,
                            };
                          }}
                          onPressIn={beginGameIdTouch}
                          onPressOut={endGameIdTouch}
                          onPress={() => {
                            if (gameIdSwipeActiveRef.current) {
                              gameIdSwipeActiveRef.current = false;
                              return;
                            }
                            keyboardFieldRef.current = 'gameId';
                            setKeyboardField('gameId');
                            sheet.open();
                          }}
                          >
                            <Text style={[styles.inputText, !props.gameId && styles.inputPlaceholder]}>
                              {props.gameId || 'Random'}
                            </Text>
                          </Pressable>
                        </View>

                        {gameInfoStatus === 'loading' && (
                          <Text style={styles.gameInfoNote}>Loading…</Text>
                        )}
                        {gameInfoStatus === 'not-found' && (
                          <Text style={styles.gameInfoNote}>Game not found</Text>
                        )}

                        {round1Categories && (
                          <>
                            {(seasonNumber != null || airDate) && (
                              <Text style={styles.gameMetadata}>
                                {[
                                  seasonNumber != null ? `Season ${seasonNumber}` : null,
                                  airDate ? new Date(airDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : null,
                                ].filter(Boolean).join('  ·  ')}
                              </Text>
                            )}

                            <View style={styles.categoryTwoCol}>
                              <View style={styles.categorySubCol}>
                                <Text style={styles.label}>
                                  {'JEOPARDY!' + (round1Categories.some(c => c.clueCount < 5) ? ' *' : '')}
                                </Text>
                                {round1Categories.map(({ name, clueCount }, i) => (
                                  <View key={i} style={styles.categoryRow}>
                                    <Text style={styles.categoryName}>{sanitizeText(name)}</Text>
                                    {clueCount < 5 && <Text style={styles.clueCount}>{clueCount}/5</Text>}
                                  </View>
                                ))}
                              </View>

                              {round2Categories && (
                                <View style={styles.categorySubCol}>
                                  <Text style={styles.label}>
                                    {'DOUBLE!' + (round2Categories.some(c => c.clueCount < 5) ? ' *' : '')}
                                  </Text>
                                  {round2Categories.map(({ name, clueCount }, i) => (
                                    <View key={i} style={styles.categoryRow}>
                                      <Text style={styles.categoryName}>{sanitizeText(name)}</Text>
                                      {clueCount < 5 && <Text style={styles.clueCount}>{clueCount}/5</Text>}
                                    </View>
                                  ))}
                                </View>
                              )}
                            </View>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                </ScrollView>
                </Animated.View>
              </View>
            );
          })()}

          {/* Error status line */}
          {props.error && (
            <View style={styles.statusLineWrap}>
              <Text style={styles.statusLine}>{props.error}</Text>
            </View>
          )}

        </Animated.View>

        <KeyboardSheet controls={sheet}>
          <NumberKeyboard
            dark
            decimal={keyboardField === 'buzzerDelay'}
            onInsert={insertGameIdDigit}
            onBackspace={backspaceGameId}
          />
        </KeyboardSheet>

        {/* Drag-left → right-side ">" chevron (matches JoinGameScreen) */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.exitIcon,
            styles.exitIconRight,
            { opacity: dragLeftChevronOpacity, transform: [{ translateX: dragLeftChevronTranslateX }] },
          ]}
        >
          <View style={styles.chevron}>
            <View style={[styles.chevronStroke, styles.chevronTop]} />
            <View style={[styles.chevronStroke, styles.chevronBottom]} />
          </View>
        </Animated.View>

        {/* Drag-right → left-side "<" chevron (matches JoinGameScreen) */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.exitIcon,
            styles.exitIconLeft,
            { opacity: dragRightChevronOpacity, transform: [{ translateX: dragRightChevronTranslateX }] },
          ]}
        >
          <View style={[styles.chevron, styles.chevronFlipped]}>
            <View style={[styles.chevronStroke, styles.chevronTop]} />
            <View style={[styles.chevronStroke, styles.chevronBottom]} />
          </View>
        </Animated.View>

      </Animated.View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Board fills entire page as backdrop, with a little breathing room around edges
  boardBackdrop: {
    position: 'absolute',
    top: 6,
    left: 8,
    right: 8,
    bottom: 0,
  },
  // Gradient covers the full screen from top, fading board out high up
  boardGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contentLayer: {
    // sits above board + gradient
  },
  // ── Bottom interactive section ─────────────────────────────────────────
  bottomSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: 18,  // keep bugs off the very bottom edge
  },
  playerRow: {
    flexDirection: 'row',
    gap: 10,
    // no bottom margin — paddingBottom on bottomSection handles the gap
  },
  // ── Lobby code ─────────────────────────────────────────────────────────
  codeBlock: {
    alignItems: 'center',
    marginBottom: 12,
    paddingTop: 8,  // Anton ascenders clip without breathing room
  },
  codeLabel: {
    fontFamily: typeTokens.board,
    fontSize: 14,
    color: colors.categoryText,
    marginTop: 2,
  },
  codeValue: {
    fontFamily: typeTokens.board,
    fontSize: 38,
    color: colors.gold,
    lineHeight: 44,
    textShadowColor: 'rgba(229,178,13,0.15)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  // ── Settings panel ──────────────────────────────────────────────────────
  // Phase 1: gradient grows from the bottom of the screen upward.
  settingsGradientWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Soft fade at the top leading edge as the gradient sweeps upward.
  settingsGradientEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
  },
  // Solid fill that sits below the fade, ensuring full coverage.
  settingsGradientSolid: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  // Phase 2: content layer (opacity animated after gradient finishes).
  settingsDragHandle: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 10,
  },
  settingsDragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  settingsScroll: {
    flex: 1,
  },
  settingsScrollContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  // ── Settings content (two-column, on dark backdrop) ────────────────────
  advancedSection: {
    width: '100%',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  gameSettingsTitle: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.categoryText,
    textAlign: 'center',
    marginBottom: 24,
  },
  settingsTwoCol: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 0,
  },
  settingsColLeft: {
    width: 130,
  },
  settingsColRight: {
    flex: 1,
  },
  stackedLabel: {
    marginTop: 20,
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
  catCountRow: {
    flexDirection: 'row',
    gap: 14,
  },
  catCountBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  catCountBtnActive: {},
  catCountText: {
    fontFamily: typeTokens.board,
    fontSize: 26,
    color: '#444',
  },
  catCountTextActive: {
    color: colors.gold,
  },
  label: {
    fontFamily: typeTokens.ui700,
    fontSize: 11,
    letterSpacing: 1.6,
    color: '#555',
    marginBottom: 2,
  },
  input: {
    justifyContent: 'center',
    marginBottom: 2,
  },
  // Keep the picker easy to grab without changing the visible input or
  // taking additional space away from the category list.
  gameIdPickerTouchArea: {
    marginTop: -8,
    marginHorizontal: -10,
    marginBottom: -56,
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 56,
  },
  buzzerDelayTouchArea: {
    minHeight: 34,
    justifyContent: 'center',
  },
  buzzerDelayInput: {
    minHeight: 30,
    justifyContent: 'center',
  },
  buzzerDelayText: {
    fontFamily: typeTokens.board,
    fontSize: 22,
    color: '#fff',
  },
  categoryTwoCol: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  categorySubCol: {
    flex: 1,
  },
  inputText: {
    fontFamily: typeTokens.board,
    fontSize: 30,
    color: '#fff',
  },
  inputPlaceholder: {
    color: '#333',
  },
  gameMetadata: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  roundToggle: {
    marginTop: 14,
  },
  roundToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
  },
  categoryList: {
    maxHeight: 160,
    marginTop: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 1,
  },
  categoryName: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#bbb',
  },
  clueCount: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#e87c1e',
  },
  gameInfoNote: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#666',
    marginTop: 6,
    fontStyle: 'italic',
  },
  // ── Error status ────────────────────────────────────────────────────────
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
  // ── Category R1/R2 toggle overlay ───────────────────────────────────────
  catOverlayRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  catOverlayCol: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  // Full-cell overlay panel: same blue as board cells, fades in over R1 name
  catOverlayPanel: {
    backgroundColor: colors.cell,
    borderRadius: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    paddingVertical: 4,
  },
  catOverlayText: {
    fontFamily: typeTokens.board,
    fontSize: 44,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
  // ── Exit chevron icons (JoinGameScreen pattern) ─────────────────────────
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
  exitIconLeft: { left: 8 },
  exitIconRight: { right: 8 },
  exitIconTop: {
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
  chevron: {
    width: 24,
    height: 24,
  },
  chevronFlipped: {
    transform: [{ scaleX: -1 }],
  },
  chevronDown: {
    transform: [{ rotate: '90deg' }],
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
