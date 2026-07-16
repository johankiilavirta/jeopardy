import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { sendAction } from '../../src/client';
import { computeReadingMs } from '../../src/readingTime';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import type { Transport } from '../../src/transport';
import type { Action, GameState, GameStatus } from '../../src/types';
import type { CellRect } from '../components/BoardCell';
import { CategoryIntro } from '../components/CategoryIntro';
import { ExpandingClueOverlay } from '../components/ExpandingClueOverlay';
import { PLAYER_BAR_HEIGHT, PlayerHeader } from '../components/PlayerHeader';
import { JudgementTray } from '../components/JudgementTray';
import { SwipeUpMenu } from '../components/SwipeUpMenu';
import { UndoRedoSwipe } from '../components/UndoRedoSwipe';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { toBoardDefinition, makeClueGetter, getVisibleBoard } from '../../data/gameLoader';
import type { GameData, RoundNumber } from '../../data/gameLoader';
import { MainMenuScreen } from '../screens/MainMenuScreen';
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
  peerDisconnected?: boolean;
  roomCode?: number;
  relayHost?: string;
  relayPort?: string;
  onLeave?: () => void;
  onNewGame?: () => void;
  onJoinGame?: () => void;
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHostSetting?: string;
  onRelayHostChange?: (host: string) => void;
  relayPortSetting?: string;
  onRelayPortChange?: (port: string) => void;
  /** Master toggle for in-game animations (set in the lobby). Default on. */
  animationsEnabled?: boolean;
  onAnimationsChange?: (enabled: boolean) => void;
  /** How many category columns to show (4, 5, or 6). Default 6. */
  visibleCategories?: number | undefined;
  onVisibleCategoriesChange?: (n: number) => void;
  isResume?: boolean | undefined;
}

const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number }>> = {
  CLUE_READING: { ms: 5000 },
  BUZZ_OPEN: { ms: 20000 },
  CLUE_EXPIRED: { ms: 5000 },
};



export function NetworkedGame({ transport, serverPeerId, initialState, boardData, peerDisconnected, roomCode, relayHost, relayPort, onLeave, onNewGame, onJoinGame, playerName, onNameChange, relayHostSetting, onRelayHostChange, relayPortSetting, onRelayPortChange, animationsEnabled = true, onAnimationsChange, visibleCategories = 6, onVisibleCategoriesChange, isResume }: NetworkedGameProps) {
  // createClient is called in App.tsx before this component mounts, so
  // STATE_UPDATE messages are never lost. App.tsx passes the latest state
  // down as initialState (updated on every STATE_UPDATE from the server).
  const [gameState, setGameState] = useState<GameState | null>(initialState?.state ?? null);
  const fadeToBlackAnim = useRef(new Animated.Value(0)).current;
  const currentVisibleStateRef = useRef<GameState | null>(initialState?.state ?? null);
  // The newest server state, always — the fade below holds the *visible*
  // state back for a second, and its completion must swap to whatever is
  // latest by then (an undo may have superseded the faded-to state).
  const latestStateRef = useRef<GameState | null>(initialState?.state ?? null);
  const fjFadeActiveRef = useRef(false);

  useEffect(() => {
    if (!initialState?.state) return;
    const incoming = initialState.state;
    latestStateRef.current = incoming;
    const current = currentVisibleStateRef.current;

    if (incoming.status === 'FINAL_JEOPARDY_WAGER') {
      // While a fade is already running, don't restart it — just keep the
      // frozen screen's scores current; the running fade swaps to
      // latestStateRef when it lands.
      if (fjFadeActiveRef.current && current) {
        const tempState = { ...current, players: incoming.players };
        currentVisibleStateRef.current = tempState;
        setGameState(tempState);
        return;
      }

      // Cinematic fade only on the genuine forward entry into Final
      // Jeopardy. Undo/redo landing on a wager state from inside the final
      // round (current clue is already the sentinel) swaps directly below.
      const enteringFinal =
        current != null &&
        current.status !== 'FINAL_JEOPARDY_WAGER' &&
        current.status !== 'FINAL_JEOPARDY_ANSWER' &&
        current.activeClue?.id !== -1;

      if (enteringFinal) {
        fjFadeActiveRef.current = true;
        Animated.timing(fadeToBlackAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }).start(({ finished }) => {
          fjFadeActiveRef.current = false;
          if (!finished) return;
          const latest = latestStateRef.current ?? incoming;
          currentVisibleStateRef.current = latest;
          setGameState(latest);

          Animated.timing(fadeToBlackAnim, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }).start();
        });

        // Keep the old screen visible during the fade, but with the new
        // scores so the +/- animation plays over it.
        const tempState = { ...current, players: incoming.players };
        currentVisibleStateRef.current = tempState;
        setGameState(tempState);
        return;
      }
    }

    // Direct swap. A mid-flight fade toward Final Jeopardy is superseded by
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

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const playerId = initialState?.playerId ?? null;
  // Deadlines (epoch ms) for the current phase window and the local player's
  // personal typing timer — they drive the activation lights' drain.
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
  const [introRound, setIntroRound] = useState<number | null>(() => {
    // If we are connecting to a game already in progress (e.g., clues burned or active clue is open),
    // skip the category intro animation.
    const initialGame = initialState?.state;
    const hasProgress = isResume || (initialGame && (initialGame.burnedClueIds.length > 0 || initialGame.activeClue != null));
    if (animationsEnabled && !hasProgress && !introShownRef.current.has(1)) {
      introShownRef.current.add(1);
      return 1;
    }
    // Mark round 1 as shown if skipping
    if (hasProgress) {
      introShownRef.current.add(1);
    }
    return null;
  });
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

  const dispatch = useCallback((action: Action) => {
    sendAction(transport, serverPeerId, action as unknown as Record<string, unknown>);
  }, [transport, serverPeerId]);

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
    } else if (gameState.status === 'FINAL_JEOPARDY_WAGER' || gameState.status === 'FINAL_JEOPARDY_ANSWER') {
      buzzWindowDeadlineRef.current = Date.now() + 30000;
    }
    previousStatusRef.current = gameState.status;
  }

  const localBuzz = gameState && playerId ? getBuzz(gameState, playerId) : undefined;
  const typing =
    (gameState?.status === 'BUZZ_OPEN' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'ANSWERING' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'FINAL_JEOPARDY_WAGER' && localBuzz && !localBuzz.locked) ||
    (gameState?.status === 'FINAL_JEOPARDY_ANSWER' && localBuzz && !localBuzz.locked);

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

  // Round transition: once every Jeopardy! (round 1) clue is burned, switch
  // the board to Double Jeopardy! (round 2). Round 2 clue ids live in their
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
    if (!playerId) return;
    selectedCellRef.current = { clueId, rect };
    dispatch({ type: 'SELECT_CLUE', playerId, clue: getClue(clueId) });
  }, [dispatch, playerId, getClue]);

  const handleSkipClue = useCallback((clueId: number) => {
    if (playerId) dispatch({ type: 'SKIP_CLUE', playerId, clueId });
  }, [dispatch, playerId]);

  // Stable identity so the memoized ActivationLights can skip re-rendering
  // its 171 lamps on renders that don't change the timer window.
  const lights = useMemo(() => {
    const show = gameState?.status === 'BUZZ_OPEN' || gameState?.status === 'ANSWERING' || gameState?.status === 'FINAL_JEOPARDY_WAGER' || gameState?.status === 'FINAL_JEOPARDY_ANSWER';
    if (!show || buzzWindowDeadlineRef.current == null) return null;
    const isFinal = gameState?.status === 'FINAL_JEOPARDY_WAGER' || gameState?.status === 'FINAL_JEOPARDY_ANSWER';
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
  const activeClueId = gameState?.activeClue?.id ?? null;
  const handleAnswerChange = useCallback((text: string) => {
    if (playerId == null) return;
    if (activeClueId != null) setLocalEcho({ clueId: activeClueId, text });
    dispatch({ type: 'SET_ANSWER', playerId, text });
  }, [dispatch, playerId, activeClueId]);
  const shownAnswer =
    typing && localEcho?.clueId === activeClueId ? localEcho.text : localBuzz?.answer ?? '';

  // The wager and answer phases share the final clue's sentinel id (-1), so
  // a clue-id-keyed echo would carry the typed wager digits straight into
  // the answer keyboard. Drop the echo at the phase boundary — the server's
  // fresh (empty) answer takes over.
  useEffect(() => {
    if (gameState?.status === 'FINAL_JEOPARDY_ANSWER') setLocalEcho(null);
  }, [gameState?.status]);

  // Solo mode: auto-dismiss the reveal after 2.5 s. The player can still
  // swipe or use arrow keys to self-judge (and record a score) before then.
  // Final Jeopardy is exempt: it can't be skipped — every answer needs a
  // verdict to reach GAME OVER.
  useEffect(() => {
    if (!gameState || !playerId) return;
    if (Object.keys(gameState.players).length !== 1) return;
    if (gameState.status !== 'REVEAL' || !gameState.activeClue) return;
    if (gameState.activeClue.id === -1) return;
    const clueId = gameState.activeClue.id;
    const timer = setTimeout(() => {
      dispatch({ type: 'SKIP_CLUE', playerId, clueId });
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.status, gameState?.activeClue?.id, playerId]);

  if (!gameState || !playerId) {
    console.log('Stuck on connecting! gameState:', !!gameState, 'playerId:', playerId);
    return (
      <View style={styles.connecting}>
        <Text style={styles.connectingText}>Connecting...</Text>
      </View>
    );
  }

  const onStand = judgedPlayerId(gameState);

  // Final Jeopardy spans three statuses — WAGER, ANSWER, and the shared
  // REVEAL used for judging — but the clue keeps its sentinel id (-1)
  // through all of them, so the black backdrop keys off the clue, not the
  // status. The backdrop always stops short of the player bar; whether the
  // bar actually shows there is ChooseClueScreen's slide (visible for the
  // wager and judging, slid away during the answer), which reads seamlessly
  // because the bar's rail matches the backdrop color.
  const isFinalClue = gameState.activeClue?.id === -1;

  // Everyone's answer goes on the stand at once in Final Jeopardy; normal
  // play judges one buzzer at a time in buzz order.
  const stands =
    gameState.status === 'REVEAL'
      ? isFinalClue
        ? gameState.buzzes.map(b => ({ playerId: b.playerId, answer: b.answer }))
        : onStand
          ? [{ playerId: onStand, answer: getBuzz(gameState, onStand)?.answer ?? '' }]
          : []
      : [];

  const disconnectedPlayerId = peerDisconnected
    ? Object.keys(gameState.players).find(id => id !== playerId) ?? null
    : null;

  // Update the Y-key handler every render so it closes over fresh state.
  yKeyHandlerRef.current = () => {
    if (gameState.activeClue) return;
    const allIds = fullBoard.categories.flatMap(c => c.clues.map(cl => cl.id));
    const unburned = allIds.filter(id => !burnedClueIds.includes(id));
    if (unburned.length <= 1) return;
    unburned.slice(0, -1).forEach(clueId => {
      dispatch({ type: 'SKIP_CLUE', playerId, clueId });
    });
  };

  // Names for the fly-by: categories beyond visibleCategories are reserve
  // categories (marked " *") that will backfill as columns clear.
  // When visibleCategories >= 6, nothing is hidden so no "*" is needed.
  const introBoard =
    introRound != null
      ? (boardData ? toBoardDefinition(boardData, introRound as RoundNumber) : demoBoard)
      : null;
  const introCategories =
    introBoard?.categories.map((c, i) =>
      i >= visibleCategories ? `${c.name} *` : c.name,
    ) ?? null;

  return (
    <UndoRedoSwipe
      canUndo={initialState?.canUndo ?? false}
      canRedo={initialState?.canRedo ?? false}
      onUndo={() => sendAction(transport, serverPeerId, { type: 'UNDO' })}
      onRedo={() => sendAction(transport, serverPeerId, { type: 'REDO' })}
    >
    <View style={styles.root}>
    <SwipeUpMenu
      disabled={!!gameState.activeClue}
      renderMenu={showSettings => (
        <MainMenuScreen
          onNewGame={onNewGame ?? onLeave ?? (() => {})}
          onJoinGame={onJoinGame ?? onLeave ?? (() => {})}
          onSettings={showSettings}
        />
      )}
      renderSettings={(_goBack, close) => (
        <InGameSettingsScreen
          onClose={close}
          animationsEnabled={animationsEnabled}
          onAnimationsChange={onAnimationsChange ?? (() => {})}
          visibleCategories={visibleCategories}
          onVisibleCategoriesChange={onVisibleCategoriesChange ?? (() => {})}
          playerName={playerName ?? ''}
          onNameChange={onNameChange ?? (() => {})}
          relayHost={relayHostSetting ?? relayHost ?? 'localhost'}
          onRelayHostChange={onRelayHostChange ?? (() => {})}
          relayPort={relayPortSetting ?? relayPort ?? '8787'}
          onRelayPortChange={onRelayPortChange ?? (() => {})}
        />
      )}
    >
      <View style={styles.root}>
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
            boardAnimKey={animationsEnabled ? boardAnimKeyRef.current : 0}
            animationsEnabled={animationsEnabled}
            judgingPlayerId={gameState.status === 'REVEAL' && !isFinalClue ? onStand : null}
            onSelectClue={handleSelectClue}
            onSkipClue={handleSkipClue}
          />
        </View>

        {peerDisconnected && !gameState.activeClue && (
          <View style={[styles.statusLineWrap, styles.rejoinWrap]}>
            <Text style={styles.statusLine}>
              {`${relayHost ?? 'localhost'}:${relayPort ?? '8787'} @ ${roomCode ?? '???'}`}
            </Text>
          </View>
        )}

        {gameState.activeClue && (
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
              key={gameState.activeClue.id}
              animate={animationsEnabled && gameState.activeClue.id !== -1}
              bottomInset={PLAYER_BAR_HEIGHT}
              fromRect={
                selectedCellRef.current?.clueId === gameState.activeClue.id
                  ? selectedCellRef.current.rect
                  : null
              }
            >
            <ClueScreen
              clue={gameState.activeClue}
              isFinalJeopardyWager={gameState.status === 'FINAL_JEOPARDY_WAGER'}
              canBuzz={gameState.status === 'BUZZ_OPEN' && !localBuzz}
              lights={lights}
              showKeyboard={typing}
              keyboardType={gameState.status === 'FINAL_JEOPARDY_WAGER' ? 'number' : 'text'}
              inputPrefix={gameState.status === 'FINAL_JEOPARDY_WAGER' ? '$' : ''}
              placeholder={gameState.status === 'FINAL_JEOPARDY_WAGER' ? 'ENTER WAGER' : 'TYPE YOUR ANSWER'}
              onMaxWager={gameState.status === 'FINAL_JEOPARDY_WAGER' ? () => handleAnswerChange(String(gameState.players[playerId]?.score ?? 0)) : undefined}
              onSkip={() => {
                if (gameState.activeClue) dispatch({ type: 'SKIP_CLUE', playerId, clueId: gameState.activeClue.id });
              }}
              canJudge={false}
              onBuzz={() => dispatch({ type: 'BUZZ', playerId })}
              answer={shownAnswer}
              onAnswerChange={handleAnswerChange}
              onLockAnswer={text =>
                dispatch({ type: 'LOCK_ANSWER', playerId, answer: text })
              }
              onUnlockAnswer={
                localBuzz?.locked
                  ? () => dispatch({ type: 'UNLOCK_ANSWER', playerId })
                  : undefined
              }
              reveal={
                gameState.status === 'REVEAL' || gameState.status === 'CLUE_EXPIRED'
                  ? { correctAnswer: gameState.activeClue.answer }
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
            finalJeopardy={isFinalClue}
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
          />
        )}

        {gameState.status === 'GAME_OVER' && (() => {
          const PLAYER_COLORS = ['#5B8DEF', '#E8A035'];
          const sorted = Object.values(gameState.players).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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
              <Text style={styles.gameOverText}>GAME OVER</Text>
              <View style={[landscape ? styles.gameOverRow : undefined, { width: landscape ? contentW : undefined }]}>
                <View style={landscape ? styles.gameOverPlayersCol : undefined}>
                  {sorted.map((p, i) => {
                    const total = p.correct + p.incorrect;
                    const pct = total > 0 ? Math.round((p.correct / total) * 100) : 0;
                    // Mock stats — replace with real data when available
                    const buzzSpeedMs = 1200 + Math.round(Math.abs(Math.sin(p.id.length * 7)) * 3000);
                    const firstBuzzPct = 20 + Math.round(Math.abs(Math.cos(p.id.length * 3)) * 60);
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
                        <Text style={styles.gameOverStats}>
                          {firstBuzzPct}% buzzed first · {buzzSpeedMs}ms average reaction
                        </Text>
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
            </View>
          );
        })()}

      </View>
    </SwipeUpMenu>
    </View>
    </UndoRedoSwipe>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  statusLineWrap: {
    position: 'absolute',
    left: 24,
    bottom: 20,
    height: 40,
    justifyContent: 'center',
    zIndex: 1,
  },
  statusLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.65)',
  },
  rejoinWrap: {
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
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
  gameOverOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
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
});
