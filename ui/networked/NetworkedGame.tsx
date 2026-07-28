import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { sendAction } from '../../src/client';
import { createKeystrokeThrottle, type KeystrokeThrottle } from '../../src/answerThrottle';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import type { Transport } from '../../src/transport';
import type { Action, ActiveClue, GameState, GameStatus } from '../../src/types';
import type { CellRect } from '../components/BoardCell';
import { CategoryIntro } from '../components/CategoryIntro';
import { ExpandingClueOverlay } from '../components/ExpandingClueOverlay';
import { PLAYER_BAR_HEIGHT, PlayerHeader } from '../components/PlayerHeader';
import { JudgementTray } from '../components/JudgementTray';
import { UndoRedoSwipe } from '../components/UndoRedoSwipe';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { toBoardDefinition, makeClueGetter, getVisibleBoard } from '../../data/gameLoader';
import type { GameData, RoundNumber } from '../../data/gameLoader';
import type { MatchResult } from '../../app/matchHistory';
import type { SessionMode } from '../../app/sessionProvider';
import { triggerBuzzFeedback } from '../../app/buzzFeedback';
import { lookupSpokenText } from '../../app/ttsCache';

// Lazily resolved best-quality English voice (Premium > Enhanced > default).
let bestVoicePromise: Promise<string | undefined> | null = null;
async function getBestEnglishVoice(): Promise<string | undefined> {
  if (!bestVoicePromise) {
    bestVoicePromise = (async () => {
      try {
        const speech = await import('expo-speech');
        const voices = await speech.getAvailableVoicesAsync();
        const english = voices.filter(v => v.language.startsWith('en'));
        const quality = (v: { quality?: string; identifier: string }) =>
          v.identifier.toLowerCase().includes('premium') ? 2 : v.quality === 'Enhanced' ? 1 : 0;
        english.sort((a, b) => quality(b) - quality(a));
        return english[0]?.identifier;
      } catch {
        return undefined;
      }
    })();
  }
  return bestVoicePromise;
}
import { InGameSettingsScreen } from '../screens/InGameSettingsScreen';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ScoreChart } from '../components/ScoreChart';
import { ClueScreen } from '../screens/ClueScreen';
import { colors, type as typeTokens } from '../theme/tokens';

interface NetworkedGameProps {
  transport: Transport;
  serverPeerId: string;
  initialState?: { state: GameState; playerId: string | null; canUndo?: boolean; canRedo?: boolean } | null;
  boardData?: GameData | null;
  remotePeerConnectionStatus?: 'connected' | 'remote-disconnected';
  localIsHost?: boolean;
  localRecovery?: 'none' | 'reconnecting' | 'promoting';
  roomCode?: number;
  relayHost?: string;
  relayPort?: string;
  onLeave?: () => void;
  onNewGame?: () => void;
  onJoinGame?: () => void;
  onBoardVisible?: () => void;
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHostSetting?: string;
  onRelayHostChange?: (host: string) => void;
  relayPortSetting?: string;
  onRelayPortChange?: (port: string) => void;
  /** Master toggle for in-game animations (set in the lobby). Default on. */
  animationsEnabled?: boolean;
  /** Vibrate locally when the shared buzz window opens. */
  vibrationEnabled?: boolean;
  onVibrationChange?: (enabled: boolean) => void;
  /** Read each regular clue aloud on the host device. */
  textToSpeechEnabled?: boolean;
  onTextToSpeechChange?: (enabled: boolean) => void;
  onAnimationsChange?: (enabled: boolean) => void;
  /** How many category columns to show (1, 4, 5, or 6). Default 6. */
  visibleCategories?: number | undefined;
  onVisibleCategoriesChange?: (n: number) => void;
  isResume?: boolean | undefined;
  /** Locally recorded finished games, newest first (last-5 chips row). */
  recentMatches?: MatchResult[];
  sessionMode?: SessionMode | undefined;
}

const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number }>> = {
  CLUE_READING: { ms: 5000 },
  BUZZ_OPEN: { ms: 20000 },
  CLUE_EXPIRED: { ms: 5000 },
};

const PROPOSAL_INTRO = ['ESTHER', 'WILL', 'YOU', 'BE', 'MY', 'GIRLFRIEND?'] as const;



export function NetworkedGame({ transport, serverPeerId, initialState, boardData, remotePeerConnectionStatus = 'connected', localIsHost = false, localRecovery = 'none', roomCode, relayHost, relayPort, onLeave, onNewGame, onJoinGame, onBoardVisible, playerName, onNameChange, relayHostSetting, onRelayHostChange, relayPortSetting, onRelayPortChange, animationsEnabled = true, vibrationEnabled = false, onVibrationChange, textToSpeechEnabled = false, onTextToSpeechChange, onAnimationsChange, visibleCategories = 6, onVisibleCategoriesChange, isResume, recentMatches, sessionMode }: NetworkedGameProps) {
  // createClient is called in App.tsx before this component mounts, so
  // STATE_UPDATE messages are never lost. App.tsx passes the latest state
  // down as initialState (updated on every STATE_UPDATE from the server).
  const [gameState, setGameState] = useState<GameState | null>(initialState?.state ?? null);
  const [showLastClueButton, setShowLastClueButton] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedClueId, setExpandedClueId] = useState<number | null>(null);
  const [optimisticSelection, setOptimisticSelection] = useState<{
    clue: ActiveClue;
    rect: CellRect;
  } | null>(null);
  const fadeToBlackAnim = useRef(new Animated.Value(0)).current;
  const currentVisibleStateRef = useRef<GameState | null>(initialState?.state ?? null);
  // The newest server state, always — the fade below holds the *visible*
  // state back for a second, and its completion must swap to whatever is
  // latest by then (an undo may have superseded the faded-to state).
  const latestStateRef = useRef<GameState | null>(initialState?.state ?? null);
  const fjFadeActiveRef = useRef(false);
  const lastFeedbackStatusRef = useRef<GameStatus | null>(null);

  useEffect(() => {
    if (!initialState?.state) return;
    const incoming = initialState.state;
    latestStateRef.current = incoming;
    const current = currentVisibleStateRef.current;

    const inFinal = (s: GameState) =>
      s.status === 'FINAL_WAGER' || s.status === 'FINAL_ANSWER';

    if (inFinal(incoming)) {
      // While a fade is already running, don't restart it — just keep the
      // frozen screen's scores current; the running fade swaps to
      // latestStateRef when it lands (which may already be the answer
      // phase, if states advanced past the wager mid-fade).
      if (fjFadeActiveRef.current && current) {
        const tempState = { ...current, players: incoming.players };
        currentVisibleStateRef.current = tempState;
        setGameState(tempState);
        return;
      }

      // Cinematic fade only on the genuine forward entry into Final
      // JE Trivia. Undo/redo landing on a wager state from inside the final
      // round (current clue is already the sentinel) swaps directly below.
      const enteringFinal =
        incoming.status === 'FINAL_WAGER' &&
        current != null &&
        !inFinal(current) &&
        current.activeClue?.id !== -1;

      // The forward wager -> answer hand-off otherwise snaps the category
      // screen straight into the clue: same fade, on a quicker beat.
      // Undo back onto an answer state (current is REVEAL) swaps directly,
      // and a reconnect landing mid-answer (current == null) does too.
      const wagerToAnswer =
        incoming.status === 'FINAL_ANSWER' &&
        current?.status === 'FINAL_WAGER';

      if (enteringFinal || wagerToAnswer) {
        const [toBlackMs, fromBlackMs] = enteringFinal ? [1000, 1500] : [450, 900];
        fjFadeActiveRef.current = true;
        Animated.timing(fadeToBlackAnim, {
          toValue: 1,
          duration: toBlackMs,
          useNativeDriver: true,
        }).start(({ finished }) => {
          fjFadeActiveRef.current = false;
          if (!finished) return;
          const latest = latestStateRef.current ?? incoming;
          currentVisibleStateRef.current = latest;
          setGameState(latest);

          Animated.timing(fadeToBlackAnim, {
            toValue: 0,
            duration: fromBlackMs,
            useNativeDriver: true,
          }).start();
        });

        // Keep the old screen visible during the fade, but with the new
        // scores so the +/- animation plays over it.
        const tempState = { ...current!, players: incoming.players };
        currentVisibleStateRef.current = tempState;
        setGameState(tempState);
        return;
      }
    }

    // Direct swap. A mid-flight fade toward Final Wager is superseded by
    // this newer state (e.g. the user undid the verdict that started it) —
    // kill it so its completion can't overwrite the screen with stale state.
    if (fjFadeActiveRef.current) {
      fjFadeActiveRef.current = false;
      fadeToBlackAnim.stopAnimation();
    }
    fadeToBlackAnim.setValue(0);
    currentVisibleStateRef.current = incoming;
    setGameState(incoming);
  }, [initialState?.state, fadeToBlackAnim]);

  // Fire after BUZZ_OPEN has committed but before that frame is displayed,
  // keeping the physical cue aligned with the lights' instant-on frame.
  useLayoutEffect(() => {
    const status = gameState?.status ?? null;
    if (
      status === 'BUZZ_OPEN' &&
      lastFeedbackStatusRef.current !== 'BUZZ_OPEN' &&
      vibrationEnabled
    ) {
      void triggerBuzzFeedback();
    }
    lastFeedbackStatusRef.current = status;
  }, [gameState?.status, vibrationEnabled]);

  // Narration is deliberately driven only by the host phone. The server
  // replaces its estimated reading timer when NARRATION_STARTED arrives and
  // opens buzzing only after this device reports completion.
  useEffect(() => {
    const clue = gameState?.activeClue;
    if (
      !localIsHost ||
      !textToSpeechEnabled ||
      gameState?.status !== 'CLUE_READING' ||
      !clue ||
      expandedClueId !== clue.id
    ) return;

    let cancelled = false;
    let started = false;
    let settled = false;
    let speech: typeof import('expo-speech') | null = null;
    const finish = () => {
      if (!started || settled) return;
      settled = true;
      transport.send(serverPeerId, JSON.stringify({
        type: 'NARRATION_FINISHED',
        clueId: clue.id,
      }));
    };

    void (async () => {
      started = true;
      transport.send(serverPeerId, JSON.stringify({
        type: 'NARRATION_STARTED',
        clueId: clue.id,
      }));
      try {
        // Load lazily so a stale development client that predates
        // ExpoSpeech can still launch and play with narration disabled.
        speech = await import('expo-speech');
        const [, voiceId] = await Promise.all([speech.stop(), getBestEnglishVoice()]);
        if (cancelled) return;
        const spokenText = boardData?.gameNumber != null
          ? (lookupSpokenText(boardData.gameNumber, clue.id) ?? clue.text)
          : clue.text;
        speech.speak(spokenText, {
          ...(voiceId !== undefined && { voice: voiceId }),
          onDone: finish,
          onStopped: finish,
          onError: finish,
        });
      } catch (error) {
        console.warn('Text to speech is unavailable in this app build', error);
        finish();
        onTextToSpeechChange?.(false);
      }
    })();

    return () => {
      cancelled = true;
      finish();
      void speech?.stop();
    };
  }, [
    expandedClueId,
    gameState?.activeClue?.id,
    gameState?.activeClue?.text,
    gameState?.status,
    localIsHost,
    onTextToSpeechChange,
    serverPeerId,
    textToSpeechEnabled,
    transport,
  ]);

  // Keep the authoritative host setting current when it is changed between
  // clues from the in-game settings sheet.
  useEffect(() => {
    if (!localIsHost) return;
    transport.send(serverPeerId, JSON.stringify({
      type: 'SET_NARRATION_ENABLED',
      enabled: textToSpeechEnabled,
    }));
  }, [localIsHost, serverPeerId, textToSpeechEnabled, transport]);

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const playerId = initialState?.playerId ?? null;
  // Deadlines (epoch ms) for the current phase and shared answer window —
  // they drive the activation lights' drain.
  const previousStatusRef = useRef<GameStatus | null>(null);
  const buzzWindowDeadlineRef = useRef<number | null>(null);
  // Window rect of the cell this device last tapped, so the clue card can grow
  // out of it. Only set for clues *we* picked — a clue another player selects
  // arrives with no rect and simply appears full-screen.
  const selectedCellRef = useRef<{ clueId: number; rect: CellRect } | null>(null);
  // Category fly-by: each round plays its intro once, before the board is
  // usable. We track which rounds have already shown theirs so the intro never
  // replays (e.g. on a reconnect / state update).
  const introShownRef = useRef<Set<number>>(new Set());
  const [introRound, setIntroRound] = useState<number | null>(null);

  // Do not start the category fly-by against demoBoard while the real board
  // payload is still arriving. A fast host can deliver STATE_UPDATE before
  // React has applied the separate boardData update; waiting here guarantees
  // the intro is built from the actual game number/categories. New games
  // still animate even when that payload is ready immediately.
  useEffect(() => {
    if (introRound != null || !boardData || !gameState) return;
    const hasProgress = isResume || gameState.burnedClueIds.length > 0 || gameState.activeClue != null;
    if (hasProgress) {
      introShownRef.current.add(1);
      return;
    }
    if (animationsEnabled && !introShownRef.current.has(1)) {
      introShownRef.current.add(1);
      setIntroRound(1);
    }
  }, [animationsEnabled, boardData, gameState, introRound, isResume]);
  // Latch to 1 the first time round 2 is reached — triggers the DJ board flash.
  // If we connect directly into round 2, initialize to 1 so we skip the flash.
  const boardAnimKeyRef = useRef(0);
  const round1DoneInitially = useMemo(() => {
    const round1Board = boardData ? toBoardDefinition(boardData, 1) : demoBoard;
    const ids = round1Board.categories.flatMap(c => c.clues.map(cl => cl.id));
    return ids.length > 0 && ids.every(id => (gameState?.burnedClueIds ?? []).includes(id));
  }, [boardData, gameState?.burnedClueIds]);
  const round2AvailableInitially = !!boardData && boardData.round2.length > 0;
  if (round1DoneInitially && round2AvailableInitially && boardAnimKeyRef.current === 0) {
    boardAnimKeyRef.current = 1;
    introShownRef.current.add(2); // Skip round 2 category intro as well
  }

  const recoveringLocally = localRecovery !== 'none';

  const dispatch = useCallback((action: Action) => {
    if (recoveringLocally || remotePeerConnectionStatus === 'remote-disconnected') return;
    sendAction(transport, serverPeerId, action as unknown as Record<string, unknown>);
  }, [transport, serverPeerId, recoveringLocally, remotePeerConnectionStatus]);

  // Dev shortcut: Y key burns all-but-one clue on the current board.
  const yKeyHandlerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'y' || e.key === 'Y') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        yKeyHandlerRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Update deadlines synchronously when the phase changes so we never render with a stale clock
  if (gameState && gameState.status !== previousStatusRef.current) {
    if (gameState.status === 'BUZZ_OPEN') {
      buzzWindowDeadlineRef.current = Date.now() + PHASE_TIMERS.BUZZ_OPEN!.ms;
    } else if (gameState.status === 'FINAL_WAGER' || gameState.status === 'FINAL_ANSWER') {
      buzzWindowDeadlineRef.current = Date.now() + 30000;
    }
    previousStatusRef.current = gameState.status;
  }

  const localBuzz = gameState && playerId ? getBuzz(gameState, playerId) : undefined;
  const activeClueId = gameState?.activeClue?.id ?? null;
  const [optimisticBuzzClueId, setOptimisticBuzzClueId] = useState<number | null>(null);
  const optimisticBuzzing =
    gameState?.status === 'BUZZ_OPEN' &&
    activeClueId != null &&
    optimisticBuzzClueId === activeClueId &&
    !localBuzz;

  // A local tap raises the keyboard immediately instead of waiting for a
  // host round trip. The next authoritative state either confirms the buzz
  // (localBuzz appears) or leaves BUZZ_OPEN/the clue, which rolls it back.
  useEffect(() => {
    if (optimisticBuzzClueId == null) return;
    if (
      localBuzz ||
      gameState?.status !== 'BUZZ_OPEN' ||
      activeClueId !== optimisticBuzzClueId
    ) {
      setOptimisticBuzzClueId(null);
    }
  }, [activeClueId, gameState?.status, localBuzz, optimisticBuzzClueId]);

  const handleBuzz = useCallback(() => {
    if (
      playerId == null ||
      activeClueId == null ||
      gameState?.status !== 'BUZZ_OPEN' ||
      localBuzz ||
      optimisticBuzzing ||
      recoveringLocally ||
      remotePeerConnectionStatus === 'remote-disconnected'
    ) return;
    setOptimisticBuzzClueId(activeClueId);
    dispatch({ type: 'BUZZ', playerId });
  }, [
    activeClueId,
    dispatch,
    gameState?.status,
    localBuzz,
    optimisticBuzzing,
    playerId,
    recoveringLocally,
    remotePeerConnectionStatus,
  ]);

  const localPassed = (gameState?.passedPlayerIds ?? []).includes(playerId ?? '');
  const typing =
    optimisticBuzzing ||
    (gameState?.status === 'BUZZ_OPEN' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'ANSWERING' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'FINAL_WAGER' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'FINAL_ANSWER' && localBuzz && !localBuzz.locked);

  // Every STATE_UPDATE deserializes a fresh object tree, so identity can't
  // signal change here. Key the board pipeline on the burned list's content
  // — the only game input the board derives from — so actions that don't
  // burn anything (typing, buzzing) leave every board object untouched and
  // the memoized Board subtree skips entirely.
  const burnedKey = gameState ? gameState.burnedClueIds.join(',') : '';
  const burnedClueIds = useMemo(
    () => gameState?.burnedClueIds ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [burnedKey],
  );

  // Round transition: once every Round One (round 1) clue is burned, switch
  // the board to Round Two! (round 2). Round 2 clue ids live in their
  // own range, so the two never collide and round 1 stays fully burned.
  const round1Done = useMemo(() => {
    const round1Board = boardData ? toBoardDefinition(boardData, 1) : demoBoard;
    const ids = round1Board.categories.flatMap(c => c.clues.map(cl => cl.id));
    return ids.length > 0 && ids.every(id => burnedClueIds.includes(id));
  }, [boardData, burnedClueIds]);
  const round2Available = !!boardData && boardData.round2.length > 0;
  const round = round1Done && round2Available ? 2 : 1;

  // Latch the DJ board flash the first time round 2 is reached.
  if (round === 2 && boardAnimKeyRef.current === 0) boardAnimKeyRef.current = 1;

  const fullBoard = useMemo(
    () => (boardData ? toBoardDefinition(boardData, round) : demoBoard),
    [boardData, round],
  );
  const getClue = useMemo(
    () => (boardData ? makeClueGetter(boardData) : getClueContent),
    [boardData],
  );
  const visibleBoard = useMemo(
    () => getVisibleBoard(fullBoard, burnedClueIds, visibleCategories),
    [fullBoard, burnedClueIds, visibleCategories],
  );

  const handleSelectClue = useCallback((clueId: number, rect: CellRect) => {
    if (
      !playerId ||
      recoveringLocally ||
      remotePeerConnectionStatus === 'remote-disconnected'
    ) return;
    const clue = { ...getClue(clueId), failedPlayerIds: [] };
    selectedCellRef.current = { clueId, rect };
    setExpandedClueId(null);
    setOptimisticSelection({ clue, rect });
    dispatch({ type: 'SELECT_CLUE', playerId, clue });
  }, [
    dispatch,
    getClue,
    playerId,
    recoveringLocally,
    remotePeerConnectionStatus,
  ]);

  // Reconcile the instant local card with the authoritative host selection.
  // A rejected selection disappears instead of leaving a phantom clue open.
  useEffect(() => {
    if (!optimisticSelection) return;
    if (
      gameState?.activeClue?.id === optimisticSelection.clue.id ||
      gameState?.status !== 'CHOOSE_CLUE'
    ) {
      setOptimisticSelection(null);
      return;
    }
    const rollback = setTimeout(() => setOptimisticSelection(null), 2000);
    return () => clearTimeout(rollback);
  }, [
    gameState?.activeClue?.id,
    gameState?.status,
    optimisticSelection,
  ]);

  const handleSkipClue = useCallback((clueId: number) => {
    if (playerId) dispatch({ type: 'SKIP_CLUE', playerId, clueId });
  }, [dispatch, playerId]);

  // Stable identity so the memoized ActivationLights can skip re-rendering
  // its 171 lamps on renders that don't change the timer window.
  const lights = useMemo(() => {
    const show = gameState?.status === 'BUZZ_OPEN' || gameState?.status === 'ANSWERING' || gameState?.status === 'FINAL_WAGER' || gameState?.status === 'FINAL_ANSWER';
    if (!show || buzzWindowDeadlineRef.current == null) return null;
    const isFinal = gameState?.status === 'FINAL_WAGER' || gameState?.status === 'FINAL_ANSWER';
    return {
      deadline: buzzWindowDeadlineRef.current,
      durationMs: isFinal ? 30000 : PHASE_TIMERS.BUZZ_OPEN!.ms,
      flash: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.status]);

  // Answers echo locally the instant a key lands; SET_ANSWER still syncs
  // through the relay, but the round-trip no longer gates what the typer
  // sees. Server state stays authoritative: once the buzz locks (or the
  // clue changes) the echo is ignored and the synced answer shows.
  const [localEcho, setLocalEcho] = useState<{ clueId: number; text: string } | null>(null);
  // Keystrokes go out through a throttle (leading + trailing, full text
  // each time) so slow transports aren't flooded with per-key SET_ANSWERs.
  // The refs keep the throttle's send closure current without recreating
  // it (which would drop pending trailing text).
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;
  const answerThrottleRef = useRef<KeystrokeThrottle | null>(null);
  if (answerThrottleRef.current == null) {
    answerThrottleRef.current = createKeystrokeThrottle(text => {
      const pid = playerIdRef.current;
      if (pid != null) dispatchRef.current({ type: 'SET_ANSWER', playerId: pid, text });
    });
  }
  // A pending trailing send must not leak across a clue or phase boundary
  // (e.g. Final Wager wager digits landing in the answer phase, which
  // shares the sentinel clue id). Locks are safe without a flush: a
  // user-initiated LOCK_ANSWER carries the full text; only the server-side
  // typing timer can drop the final <250ms of typing (see answerThrottle).
  useEffect(() => {
    answerThrottleRef.current?.cancel();
  }, [activeClueId, gameState?.status]);
  useEffect(() => () => answerThrottleRef.current?.cancel(), []);
  const handleAnswerChange = useCallback((text: string) => {
    if (playerId == null) return;
    if (activeClueId != null) setLocalEcho({ clueId: activeClueId, text });
    answerThrottleRef.current?.update(text);
  }, [playerId, activeClueId]);
  const shownAnswer =
    typing && localEcho?.clueId === activeClueId ? localEcho.text : localBuzz?.answer ?? '';

  // The wager and answer phases share the final clue's sentinel id (-1), so
  // a clue-id-keyed echo would carry the typed wager digits straight into
  // the answer keyboard. Drop the echo at the phase boundary — the server's
  // fresh (empty) answer takes over.
  useEffect(() => {
    if (gameState?.status === 'FINAL_ANSWER') setLocalEcho(null);
  }, [gameState?.status]);

  if (!gameState || !playerId) {
    console.log('Stuck on connecting! gameState:', !!gameState, 'playerId:', playerId);
    return (
      <View style={styles.connecting}>
        <Text style={styles.connectingText}>Connecting...</Text>
      </View>
    );
  }

  const onStand = judgedPlayerId(gameState);
  const displayedClue = gameState.activeClue ?? optimisticSelection?.clue ?? null;
  const displayedClueRect =
    displayedClue && selectedCellRef.current?.clueId === displayedClue.id
      ? selectedCellRef.current.rect
      : null;
  const displayedClueWillAnimate =
    !!displayedClue &&
    animationsEnabled &&
    displayedClue.id !== -1 &&
    displayedClueRect != null;

  // Final Wager spans three statuses — WAGER, ANSWER, and the shared
  // REVEAL used for judging — but the clue keeps its sentinel id (-1)
  // through all of them, so the black backdrop keys off the clue, not the
  // status. The backdrop always stops short of the player bar; whether the
  // bar actually shows there is ChooseClueScreen's slide (visible for the
  // wager and judging, slid away during the answer), which reads seamlessly
  // because the bar's rail matches the backdrop color.
  const isFinalClue = displayedClue?.id === -1;

  // Everyone's answer goes on the stand at once in Final Wager; normal
  // play judges one buzzer at a time in buzz order.
  const stands =
    gameState.status === 'REVEAL'
      ? isFinalClue
        ? gameState.buzzes.map(b => ({ playerId: b.playerId, answer: b.answer }))
        : onStand
          ? [{ playerId: onStand, answer: getBuzz(gameState, onStand)?.answer ?? '' }]
          : []
      : [];

  const disconnectedPlayerId = remotePeerConnectionStatus === 'remote-disconnected'
    ? Object.keys(gameState.players).find(id => id !== playerId) ?? null
    : null;
  const remotePlayerId = Object.keys(gameState.players).find(id => id !== playerId) ?? null;
  const hostPlayerId = localIsHost ? playerId : remotePlayerId;
  const promotingPlayerId = recoveringLocally && !localIsHost ? playerId : null;

  const unburnedCurrentRoundClueIds = fullBoard.categories
    .flatMap(c => c.clues.map(cl => cl.id))
    .filter(id => !burnedClueIds.includes(id));
  const canSkipToLastClue =
    !gameState.activeClue &&
    !recoveringLocally &&
    unburnedCurrentRoundClueIds.length > 1;

  // Update the Y-key handler every render so it closes over fresh state.
  // The floating test button below calls the same action on native builds.
  const skipToLastClue = () => {
    if (!canSkipToLastClue) return;
    unburnedCurrentRoundClueIds.slice(0, -1).forEach(clueId => {
      dispatch({ type: 'SKIP_CLUE', playerId, clueId });
    });
  };
  yKeyHandlerRef.current = skipToLastClue;

  // ── Swipe-up to open settings ─────────────────────────────────────────────
  const settingsDisabled = !!gameState.activeClue || gameState.status === 'GAME_OVER';
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (settingsDisabled) return;
      if (!settingsOpenRef.current && (e.key === 'm' || e.key === 'M' || e.key === 'ArrowUp')) {
        if (e.key === 'ArrowUp') e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsDisabled]);

  const swipeUpResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      !settingsDisabled && !settingsOpenRef.current &&
      g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderRelease: (_e, g) => {
      if (!settingsDisabled && !settingsOpenRef.current && -g.dy > 60) {
        setSettingsOpen(true);
      }
    },
    onPanResponderTerminate: () => {},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settingsDisabled]);

  // Names for the fly-by: categories beyond visibleCategories are reserve
  // categories (marked " *") that will backfill as columns clear.
  // When visibleCategories >= 6, nothing is hidden so no "*" is needed.
  const introBoard =
    introRound != null
      ? (boardData ? toBoardDefinition(boardData, introRound as RoundNumber) : demoBoard)
      : null;
  const proposalIntroEnabled =
    introRound === 1 &&
    Object.values(gameState.players).some(player => player.name.trim().toUpperCase() === 'J0HAN');
  const introCategories = proposalIntroEnabled
    ? [...PROPOSAL_INTRO]
    : introBoard?.categories.map((c, i) =>
        i >= visibleCategories ? `${c.name} *` : c.name,
      ) ?? null;

  return (
    <UndoRedoSwipe
      canUndo={!recoveringLocally && (initialState?.canUndo ?? false)}
      canRedo={!recoveringLocally && (initialState?.canRedo ?? false)}
      onUndo={() => {
        if (!recoveringLocally) sendAction(transport, serverPeerId, { type: 'UNDO' });
      }}
      onRedo={() => {
        if (!recoveringLocally) sendAction(transport, serverPeerId, { type: 'REDO' });
      }}
    >
      <View style={styles.root} {...swipeUpResponder.panHandlers}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, opacity: fadeToBlackAnim, zIndex: 9999 }]}
          pointerEvents="none"
        />
        <View style={styles.root}>
          <ChooseClueScreen
            state={gameState}
            localPlayerId={playerId}
            board={visibleBoard}
            disconnectedPlayerId={disconnectedPlayerId}
            hostPlayerId={hostPlayerId}
            promotingPlayerId={promotingPlayerId}
            recovering={recoveringLocally}
            boardAnimKey={animationsEnabled ? boardAnimKeyRef.current : 0}
            onBoardVisible={!localIsHost ? onBoardVisible : undefined}
            animationsEnabled={animationsEnabled}
            judgingPlayerId={gameState.status === 'REVEAL' && !isFinalClue ? onStand : null}
            onSelectClue={handleSelectClue}
            onSkipClue={handleSkipClue}
          />
        </View>

        {showLastClueButton && canSkipToLastClue && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip to the last clue"
            onPress={skipToLastClue}
            style={({ pressed }) => [
              styles.localTestButton,
              pressed ? styles.localTestButtonPressed : undefined,
            ]}
          >
            <Text style={styles.localTestButtonText}>TEST: LAST CLUE</Text>
          </Pressable>
        )}

        {displayedClue && (
          <View style={StyleSheet.absoluteFill}>
            {isFinalClue && (
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.bg, bottom: PLAYER_BAR_HEIGHT },
                ]}
              />
            )}
            <ExpandingClueOverlay
              key={displayedClue.id}
              animate={animationsEnabled && displayedClue.id !== -1}
              bottomInset={PLAYER_BAR_HEIGHT}
              onExpanded={() => setExpandedClueId(displayedClue.id)}
              fromRect={displayedClueRect}
            >
            <ClueScreen
              clue={displayedClue}
              contentVisible={
                !displayedClueWillAnimate ||
                expandedClueId === displayedClue.id
              }
              isFinalWagerPhase={gameState.status === 'FINAL_WAGER'}
              canBuzz={
                gameState.status === 'BUZZ_OPEN' &&
                !localBuzz &&
                !optimisticBuzzing &&
                !recoveringLocally &&
                remotePeerConnectionStatus !== 'remote-disconnected'
              }
              canPass={
                !recoveringLocally &&
                displayedClue.id !== -1 &&
                !localPassed &&
                !localBuzz?.locked &&
                (
                  gameState.status === 'CLUE_READING' ||
                  gameState.status === 'BUZZ_OPEN' ||
                  gameState.status === 'ANSWERING'
                )
              }
              onPass={() => {
                answerThrottleRef.current?.cancel();
                dispatch({ type: 'PASS_CLUE', playerId });
              }}
              lights={lights}
              showKeyboard={typing}
              prepareKeyboard={
                expandedClueId === displayedClue.id &&
                (
                  gameState.status === 'CLUE_READING' ||
                  gameState.status === 'BUZZ_OPEN'
                )
              }
              keyboardType={gameState.status === 'FINAL_WAGER' ? 'number' : 'text'}
              inputPrefix={gameState.status === 'FINAL_WAGER' ? '$' : ''}
              placeholder={gameState.status === 'FINAL_WAGER' ? 'ENTER WAGER' : 'TYPE YOUR ANSWER'}
              onMaxWager={gameState.status === 'FINAL_WAGER' ? () => handleAnswerChange(String(gameState.players[playerId]?.score ?? 0)) : undefined}
              onSkip={() => {
                if (gameState.activeClue) dispatch({ type: 'SKIP_CLUE', playerId, clueId: gameState.activeClue.id });
              }}
              canJudge={false}
              onBuzz={handleBuzz}
              answer={shownAnswer}
              onAnswerChange={handleAnswerChange}
              onLockAnswer={text => {
                // Lock carries the full text; a pending trailing keystroke
                // would arrive post-lock and be ignored anyway. Drop it.
                answerThrottleRef.current?.cancel();
                dispatch({ type: 'LOCK_ANSWER', playerId, answer: text });
              }}
              onUnlockAnswer={
                localBuzz?.locked
                  ? () => {
                      answerThrottleRef.current?.cancel();
                      dispatch({ type: 'UNLOCK_ANSWER', playerId });
                    }
                  : undefined
              }
              reveal={
                gameState.status === 'REVEAL' || gameState.status === 'CLUE_EXPIRED'
                  ? { correctAnswer: displayedClue.answer }
                  : undefined
              }
              onDismiss={
                gameState.status === 'CLUE_EXPIRED' &&
                (gameState.passedPlayerIds?.length ?? 0) > 0
                  ? () => dispatch({ type: 'DISMISS_CLUE' })
                  : undefined
              }
            />
          </ExpandingClueOverlay>
          </View>
        )}

        {stands.length > 0 && (
          <JudgementTray
            players={Object.values(gameState.players)}
            localPlayerId={playerId}
            finalWager={isFinalClue}
            stands={stands}
            hasMoreToJudge={
              !isFinalClue && gameState.activeClue
                ? gameState.buzzes.some(
                    b => b.playerId !== onStand && !gameState.activeClue!.failedPlayerIds.includes(b.playerId)
                  )
                : false
            }
            onJudge={(judgedId, correct, penalty) =>
              dispatch({
                type: 'JUDGE_ANSWER',
                playerId: judgedId,
                correct,
                ...(penalty !== undefined ? { penalty } : {}),
              })
            }
          />
        )}

        {introRound != null && introCategories && !gameState.activeClue && (
          <CategoryIntro
            key={introRound}
            categories={introCategories}
            onDone={() => setIntroRound(null)}
            acceleratedFromIndex={proposalIntroEnabled ? 1 : undefined}
            paceMultiplier={proposalIntroEnabled ? 0.7 : undefined}
            finalCardPrelude={proposalIntroEnabled ? 'ESTHER, WILL YOU BE MY' : undefined}
            finalPreludeDelayMultiplier={proposalIntroEnabled ? 2 : undefined}
            waitForTapAfterFinal={proposalIntroEnabled}
          />
        )}

        {gameState.status === 'GAME_OVER' && (() => {
          const PLAYER_COLORS = ['#5B8DEF', '#E8A035'];
          const sorted = Object.values(gameState.players).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          const totalFirstBuzzes = sorted.reduce((sum, p) => sum + (p.firstBuzzCount ?? 0), 0);
          const colorByName = new Map(sorted.map((p, i) => [p.name, PLAYER_COLORS[i % PLAYER_COLORS.length]!]));
          const chartPlayers = sorted.map((p, i) => ({
            name: p.name,
            color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
            scores: p.scoreHistory,
          }));
          const landscape = windowWidth > windowHeight;
          const contentW = Math.min(windowWidth - 48, landscape ? 600 : 400);
          const chartW = landscape
            ? Math.round(contentW * 0.5)
            : contentW;

          return (
            <View style={styles.gameOverOverlay}>
              <ScrollView
                style={styles.gameOverScroll}
                contentContainerStyle={styles.gameOverContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.gameOverTopBar}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Return to main menu"
                    onPress={onLeave ?? onNewGame ?? (() => {})}
                    style={({ pressed }) => [
                      styles.gameOverMainMenuButton,
                      pressed && styles.gameOverMainMenuButtonPressed,
                    ]}
                  >
                    <Text style={styles.gameOverMainMenuText}>← MAIN MENU</Text>
                  </Pressable>
                </View>
                <View style={styles.gameOverMainContent}>
                  <Text style={styles.gameOverText}>GAME OVER</Text>
                  <View style={[landscape ? styles.gameOverRow : undefined, { width: landscape ? contentW : undefined }]}>
                    <View style={landscape ? styles.gameOverPlayersCol : undefined}>
                    {sorted.map((p, i) => {
                      const total = p.correct + p.incorrect;
                      const pct = total > 0 ? Math.round((p.correct / total) * 100) : 0;
                      const buzzCount = p.buzzCount ?? 0;
                      const avgReactionMs = buzzCount > 0 ? Math.round((p.reactionMsTotal ?? 0) / buzzCount) : null;
                      const firstBuzzPct = totalFirstBuzzes > 0 ? Math.round(((p.firstBuzzCount ?? 0) / totalFirstBuzzes) * 100) : 0;
                      return (
                        <View key={p.id} style={styles.gameOverPlayerRow}>
                          <View style={styles.gameOverNameRow}>
                            <View style={[styles.gameOverColorDot, { backgroundColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }]} />
                            <Text style={styles.gameOverScore}>
                              {p.name}: ${(p.score ?? 0).toLocaleString()}
                            </Text>
                          </View>
                          <Text style={styles.gameOverStats}>
                            {p.correct} correct · {p.incorrect} incorrect · {pct}% correctness
                          </Text>
                          {buzzCount > 0 && (
                            <Text style={styles.gameOverStats}>
                              {firstBuzzPct}% buzzed first · {avgReactionMs}ms average reaction
                            </Text>
                          )}
                          {gameState.finalWagers?.[p.id] != null && (
                            <Text style={styles.gameOverStats}>
                              ${gameState.finalWagers[p.id]!.toLocaleString()} final wager
                            </Text>
                          )}
                        </View>
                      );
                    })}
                    </View>
                    <ScoreChart players={chartPlayers} width={chartW} height={160} />
                  </View>
                  {recentMatches != null && recentMatches.length > 0 && (
                    <View style={styles.gameOverHistoryWrap}>
                      <Text style={styles.gameOverHistoryLabel}>LAST 5 GAMES</Text>
                      <View style={styles.gameOverHistoryRow}>
                        {recentMatches.slice(0, 5).reverse().map(m => {
                          const tie = m.winnerNames.length !== 1;
                          const winner = m.winnerNames[0];
                          const initialColor = tie
                            ? 'rgba(255,255,255,0.5)'
                            : colorByName.get(winner!) ?? 'rgba(255,255,255,0.5)';
                          const initial = tie ? '–' : winner!.trim().charAt(0).toUpperCase();
                          return (
                            <View key={m.id} style={styles.gameOverHistoryChip}>
                              <Text style={[styles.gameOverHistoryChipText, { color: initialColor }]}>{initial}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          );
        })()}

      </View>

      {settingsOpen && (
        <InGameSettingsScreen
          onClose={() => setSettingsOpen(false)}
          onQuit={onLeave ?? (() => {})}
          animationsEnabled={animationsEnabled}
          onAnimationsChange={onAnimationsChange ?? (() => {})}
          vibrationEnabled={vibrationEnabled}
          onVibrationChange={onVibrationChange ?? (() => {})}
          textToSpeechEnabled={textToSpeechEnabled}
          onTextToSpeechChange={onTextToSpeechChange ?? (() => {})}
          showTextToSpeech={localIsHost}
          visibleCategories={visibleCategories}
          onVisibleCategoriesChange={onVisibleCategoriesChange ?? (() => {})}
          showLastClueButton={showLastClueButton}
          onShowLastClueButtonChange={setShowLastClueButton}
          playerName={playerName ?? ''}
          onNameChange={onNameChange ?? (() => {})}
          relayHost={relayHostSetting ?? relayHost ?? 'localhost'}
          onRelayHostChange={onRelayHostChange ?? (() => {})}
          relayPort={relayPortSetting ?? relayPort ?? '8787'}
          onRelayPortChange={onRelayPortChange ?? (() => {})}
          roomCode={roomCode}
          sessionMode={sessionMode}
        />
      )}
    </UndoRedoSwipe>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  connecting: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectingText: {
    fontFamily: typeTokens.ui500,
    fontSize: 20,
    color: colors.categoryText,
  },
  localTestButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 500,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  localTestButtonPressed: {
    opacity: 0.55,
  },
  localTestButtonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 11,
    letterSpacing: 0.7,
    color: '#fff',
  },
  gameOverOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    zIndex: 10000,
  },
  gameOverScroll: {
    flex: 1,
    width: '100%',
  },
  gameOverContent: {
    flexGrow: 1,
  },
  gameOverTopBar: {
    width: '100%',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingLeft: 8,
  },
  gameOverMainContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  gameOverText: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.boardValue,
    marginBottom: 20,
  },
  gameOverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gameOverPlayersCol: {
    flex: 5,
    justifyContent: 'center',
  },
  gameOverPlayerRow: {
    marginVertical: 8,
  },
  gameOverNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gameOverColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  gameOverScore: {
    fontFamily: typeTokens.ui700,
    fontSize: 20,
    color: '#fff',
  },
  gameOverStats: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  gameOverHistoryWrap: {
    marginTop: 24,
    alignItems: 'center',
  },
  gameOverHistoryLabel: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.6)',
  },
  gameOverHistoryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  gameOverHistoryChip: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameOverHistoryChipText: {
    fontFamily: typeTokens.ui700,
    fontSize: 16,
  },
  gameOverMainMenuButton: {
    padding: 8,
  },
  gameOverMainMenuButtonPressed: {
    opacity: 0.55,
  },
  gameOverMainMenuText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    letterSpacing: 0.8,
    color: colors.gold,
  },
});
