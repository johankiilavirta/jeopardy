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
import { loadGameInfo, type GameInfo } from '../../data/gameLoader';
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

  return (
    <View style={bugStyles.bug}>
      <Text style={bugStyles.roleLabel} allowFontScaling={false}>
        {isHostSlot ? 'HOST' : 'PLAYER 2'}
      </Text>
      <Text
        style={[bugStyles.name, !filled && bugStyles.nameWaiting]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        allowFontScaling={false}
      >
        {filled ? player.name.toUpperCase() : 'WAITING…'}
      </Text>

      {/* Settings gear — only on host slot, only visible to the host */}
      {isHostSlot && localIsHost && (
        <Pressable
          style={bugStyles.actionBtn}
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel={settingsOpen ? 'Close game settings' : 'Open game settings'}
        >
          {settingsOpen ? (
            <Text style={bugStyles.closeIcon}>×</Text>
          ) : (
            <SettingsGlyph />
          )}
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
    borderRadius: 4,
    width: 'auto',
    paddingHorizontal: 8,
    height: 26,
    top: undefined,
    bottom: 10,
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
  const setupScrollRef = useRef<ScrollView | null>(null);
  const advancedYRef = useRef(0);
  const gameIdLayoutRef = useRef({ y: 0, height: 0 });
  const fadeStartedRef = useRef(false);
  const pageX = useRef(new Animated.Value(0)).current;
  const gestureAxisRef = useRef<'horizontal' | 'vertical' | null>(null);
  const dragXRef = useRef(0);
  const dragYRef = useRef(0);
  const leavingRef = useRef(false);
  const startRequestedRef = useRef(false);

  // ── Keyboard sheet for game # entry ──────────────────────────────────────

  const sheet = useKeyboardSheet(
    () => {
      const layout = gameIdLayoutRef.current;
      if (!layout.height) return;
      const keyboardTop = height - sheet.panelHeight;
      const targetTop = (keyboardTop - layout.height) / 2;
      const y = Math.max(0, layout.y - targetTop);
      requestAnimationFrame(() => {
        setupScrollRef.current?.scrollTo({ y, animated: true });
      });
    },
  );

  const insertGameIdDigit = useCallback((digit: string) => {
    props.onGameIdChange?.(`${props.gameId ?? ''}${digit}`.replace(/\D/g, '').slice(0, 6));
  }, [props]);

  const backspaceGameId = useCallback(() => {
    props.onGameIdChange?.((props.gameId ?? '').slice(0, -1));
  }, [props]);

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

  // ── Game info loading ─────────────────────────────────────────────────────

  useEffect(() => {
    const id = props.gameId;
    if (!id || !/^\d+$/.test(id) || Number(id) < 1) {
      setRound1Categories(null);
      setRound2Categories(null);
      setAirDate(null);
      setSeasonNumber(null);
      setGameInfoStatus('idle');
      return;
    }
    setGameInfoStatus('loading');
    const timer = setTimeout(async () => {
      const applyInfo = (data: GameInfo) => {
        setRound1Categories(data.round1 ?? null);
        setRound2Categories(data.round2 ?? null);
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

  const lobbyBoard = useMemo((): BoardDefinition => {
    if (!round1Categories || round1Categories.length === 0) {
      return demoBoard;
    }
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
    const hostPlayer = props.players.find(p => p.isHost) ?? null;
    const guestPlayer = props.players.find(p => !p.isHost) ?? null;
    return [hostPlayer, guestPlayer];
  }, [props.players]);

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

  const leaveLobby = useCallback((direction: -1 | 1) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    Animated.timing(pageX, {
      toValue: direction * width,
      duration: 240,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) props.onLeave();
      else leavingRef.current = false;
    });
  }, [pageX, props.onLeave, width]);

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

  // Gradient starts near the top and becomes fully opaque well before the
  // $600 row — categories + $200 visible, $400 half-visible, rest hidden.
  const gradientLocations: [number, number] = [0.15, 0.52];

  return (
    <View style={styles.root} {...lobbyPanResponder.panHandlers}>
      <Animated.View style={[styles.page, { transform: [{ translateX: pageX }] }]}>

        {/* 1. Game board as non-interactive backdrop */}
        <View style={styles.boardBackdrop} pointerEvents="none">
          <Board
            board={lobbyBoard}
            burnedClueIds={EMPTY_BURNED}
            locked={true}
          />
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
            <View style={styles.codeBlock}>
              <Text style={styles.codeLabel}>LOBBY CODE</Text>
              {props.roomCode > 0 ? (
                <Text style={styles.codeValue}>{props.roomCode}</Text>
              ) : (
                <Text style={styles.creatingText}>CREATING…</Text>
              )}
            </View>

            <View style={styles.playerRow}>
              {sortedSlots.map((player, i) => (
                <LobbySlotBug
                  key={player?.peerId ?? `slot-${i}`}
                  player={player}
                  slotIndex={i}
                  localIsHost={props.isHost}
                  settingsOpen={showAdvanced}
                  onSettings={() => { sheet.close(); setShowAdvanced(v => !v); }}
                  onKick={() => { if (player) props.onKickPlayer?.(player.peerId); }}
                />
              ))}
            </View>
          </View>

          {/* Settings panel overlay */}
          {props.isHost && showAdvanced && (
            <View style={StyleSheet.absoluteFill}>
              <Pressable
                style={styles.settingsBackdrop}
                onPress={() => { sheet.close(); setShowAdvanced(false); }}
              />
              <ScrollView
                ref={setupScrollRef}
                style={styles.settingsScroll}
                contentContainerStyle={[
                  styles.settingsScrollContent,
                  { paddingBottom: 32 + sheet.panelHeight },
                ]}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                scrollEnabled
                scrollEventThrottle={16}
              >
                <View
                  style={styles.advancedSection}
                  onLayout={event => {
                    advancedYRef.current = event.nativeEvent.layout.y;
                  }}
                >
                  <Text style={styles.gameSettingsTitle}>GAME SETTINGS</Text>

                  <Text style={styles.label}>Animations</Text>
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
                      {(props.animationsEnabled ?? true) ? 'On' : 'Off'}
                    </Text>
                  </Pressable>

                  <Text style={[styles.label, styles.stackedLabel]}>Categories Displayed</Text>
                  <View style={styles.catCountRow}>
                    {([4, 5, 6] as const).map(n => {
                      const active = (props.visibleCategories ?? 6) === n;
                      return (
                        <Pressable
                          key={n}
                          style={[styles.catCountBtn, active && styles.catCountBtnActive]}
                          onPress={() => props.onVisibleCategoriesChange?.(n)}
                        >
                          <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                            {n}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[styles.label, styles.stackedLabel]}>Game #</Text>
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
                    onPress={sheet.open}
                  >
                    <Text style={[styles.inputText, !props.gameId && styles.inputPlaceholder]}>
                      {props.gameId || 'Random'}
                    </Text>
                  </Pressable>

                  {gameInfoStatus === 'loading' && (
                    <Text style={styles.gameInfoNote}>Loading...</Text>
                  )}
                  {gameInfoStatus === 'not-found' && (
                    <Text style={styles.gameInfoNote}>Game not found</Text>
                  )}

                  {round1Categories && (
                    <>
                      {seasonNumber != null && (
                        <Text style={styles.gameMetadata}>Season {seasonNumber}</Text>
                      )}
                      {airDate && (
                        <Text style={styles.gameMetadata}>
                          {new Date(airDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </Text>
                      )}

                      <Pressable
                        style={styles.roundToggle}
                        onPress={() => setShowRound1(v => !v)}
                      >
                        <Text style={styles.roundToggleText}>
                          {showRound1 ? '▾ ' : '▸ '}
                          Jeopardy!
                          {round1Categories.some(c => c.clueCount < 5) && (
                            <Text style={styles.clueCount}> *</Text>
                          )}
                        </Text>
                      </Pressable>
                      {showRound1 && (
                        <ScrollView
                          style={styles.categoryList}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator={false}
                          showsHorizontalScrollIndicator={false}
                        >
                          {round1Categories.map(({ name, clueCount }) => (
                            <View key={name} style={styles.categoryRow}>
                              <Text style={styles.categoryName}>{sanitizeText(name)}</Text>
                              {clueCount < 5 && (
                                <Text style={styles.clueCount}>{clueCount}/5</Text>
                              )}
                            </View>
                          ))}
                        </ScrollView>
                      )}

                      <Pressable
                        style={styles.roundToggle}
                        onPress={() => setShowRound2(v => !v)}
                      >
                        <Text style={styles.roundToggleText}>
                          {showRound2 ? '▾ ' : '▸ '}
                          Double Jeopardy!
                          {round2Categories?.some(c => c.clueCount < 5) && (
                            <Text style={styles.clueCount}> *</Text>
                          )}
                        </Text>
                      </Pressable>
                      {showRound2 && round2Categories && (
                        <ScrollView
                          style={styles.categoryList}
                          nestedScrollEnabled
                          showsVerticalScrollIndicator={false}
                          showsHorizontalScrollIndicator={false}
                        >
                          {round2Categories.map(({ name, clueCount }) => (
                            <View key={name} style={styles.categoryRow}>
                              <Text style={styles.categoryName}>{sanitizeText(name)}</Text>
                              {clueCount < 5 && (
                                <Text style={styles.clueCount}>{clueCount}/5</Text>
                              )}
                            </View>
                          ))}
                        </ScrollView>
                      )}
                    </>
                  )}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Error status line */}
          {props.error && (
            <View style={styles.statusLineWrap}>
              <Text style={styles.statusLine}>{props.error}</Text>
            </View>
          )}

        </Animated.View>

        <KeyboardSheet controls={sheet}>
          <NumberKeyboard dark onInsert={insertGameIdDigit} onBackspace={backspaceGameId} />
        </KeyboardSheet>

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
  },
  codeLabel: {
    fontFamily: typeTokens.ui700,
    fontSize: 11,
    letterSpacing: 2.2,
    color: '#666',
    marginBottom: 0,
  },
  codeValue: {
    fontFamily: typeTokens.board,
    fontSize: 52,
    color: colors.gold,
    lineHeight: 60,
    textShadowColor: 'rgba(229,178,13,0.15)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  creatingText: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.gold,
    opacity: 0.6,
    lineHeight: 60,
  },
  // ── Settings overlay ────────────────────────────────────────────────────
  settingsBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  settingsScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  settingsScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  // ── Advanced settings section ───────────────────────────────────────────
  advancedSection: {
    width: '100%',
    maxWidth: 470,
    padding: 18,
    marginTop: 2,
    marginBottom: 24,
    borderRadius: 8,
    backgroundColor: colors.cellFinalRecessed,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  gameSettingsTitle: {
    fontFamily: typeTokens.board,
    fontSize: 24,
    color: colors.categoryText,
    textAlign: 'center',
    marginBottom: 18,
  },
  stackedLabel: {
    marginTop: 16,
  },
  toggleBox: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
  },
  toggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
  },
  toggleTextOff: {
    color: '#666',
  },
  catCountRow: {
    flexDirection: 'row',
    gap: 6,
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
  catCountTextActive: {
    color: '#fff',
  },
  label: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
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
  gameMetadata: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#666',
    marginTop: 10,
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
    paddingVertical: 2,
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
});
