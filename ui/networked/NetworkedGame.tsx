import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { sendAction } from '../../src/client';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import type { WebSocketTransport } from '../../src/webSocketTransport';
import type { Action, GameState, GameStatus } from '../../src/types';
import type { CellRect } from '../components/BoardCell';
import { CategoryIntro } from '../components/CategoryIntro';
import { ExpandingClueOverlay } from '../components/ExpandingClueOverlay';
import { PLAYER_BAR_HEIGHT } from '../components/PlayerHeader';
import { JudgementTray } from '../components/JudgementTray';
import { SwipeUpMenu } from '../components/SwipeUpMenu';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { toBoardDefinition, makeClueGetter, getVisibleBoard } from '../../data/gameLoader';
import type { GameData, RoundNumber } from '../../data/gameLoader';
import { MainMenuScreen } from '../screens/MainMenuScreen';
import { InGameSettingsScreen } from '../screens/InGameSettingsScreen';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';
import { colors, type as typeTokens } from '../theme/tokens';

interface NetworkedGameProps {
  transport: WebSocketTransport;
  serverPeerId: string;
  initialState?: { state: GameState; playerId: string | null } | null;
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
}

const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number }>> = {
  CLUE_READING: { ms: 5000 },
  BUZZ_OPEN: { ms: 8000 },
  CLUE_EXPIRED: { ms: 5000 },
};

const ANSWER_MS = 10000;


export function NetworkedGame({ transport, serverPeerId, initialState, boardData, peerDisconnected, roomCode, relayHost, relayPort, onLeave, onNewGame, onJoinGame, playerName, onNameChange, relayHostSetting, onRelayHostChange, relayPortSetting, onRelayPortChange, animationsEnabled = true, onAnimationsChange, visibleCategories = 6, onVisibleCategoriesChange }: NetworkedGameProps) {
  // createClient is called in App.tsx before this component mounts, so
  // STATE_UPDATE messages are never lost. App.tsx passes the latest state
  // down as initialState (updated on every STATE_UPDATE from the server).
  const gameState = initialState?.state ?? null;
  const playerId = initialState?.playerId ?? null;
  // Deadlines (epoch ms) for the current phase window and the local player's
  // personal typing timer — they drive the activation lights' drain.
  const [phaseDeadline, setPhaseDeadline] = useState<number | null>(null);
  const [personalDeadline, setPersonalDeadline] = useState<number | null>(null);
  // Window rect of the cell this device last tapped, so the clue card can grow
  // out of it. Only set for clues *we* picked — a clue another player selects
  // arrives with no rect and simply appears full-screen.
  const selectedCellRef = useRef<{ clueId: number; rect: CellRect } | null>(null);
  // Category fly-by: each round plays its intro once, before the board is
  // usable. We track which rounds have already shown theirs so the intro never
  // replays (e.g. on a reconnect / state update).
  const introShownRef = useRef<Set<number>>(new Set());
  const [introRound, setIntroRound] = useState<number | null>(null);
  // Latch to 1 the first time round 2 is reached — triggers the DJ board flash.
  const boardAnimKeyRef = useRef(0);

  const dispatch = (action: Action) => {
    sendAction(transport, serverPeerId, action as unknown as Record<string, unknown>);
  };

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

  // Phase deadline estimate (display-only, server is authoritative).
  useEffect(() => {
    if (!gameState) return;
    const phase = PHASE_TIMERS[gameState.status];
    if (!phase) {
      setPhaseDeadline(null);
      return;
    }
    setPhaseDeadline(Date.now() + phase.ms);
  }, [gameState?.status]);

  const localBuzz = gameState && playerId ? getBuzz(gameState, playerId) : undefined;
  const typing =
    !!localBuzz &&
    !localBuzz.locked &&
    (gameState?.status === 'BUZZ_OPEN' || gameState?.status === 'ANSWERING');

  // Personal typing deadline (display-only).
  useEffect(() => {
    if (!typing) {
      setPersonalDeadline(null);
      return;
    }
    setPersonalDeadline(Date.now() + ANSWER_MS);
  }, [typing]);

  // Play the category fly-by once at the start of round 1 only. Round 2
  // (Double Jeopardy) transitions silently — no intro animation.
  useEffect(() => {
    if (!animationsEnabled || !boardData) return;
    if (introShownRef.current.has(1)) return;
    introShownRef.current.add(1);
    setIntroRound(1);
  }, [animationsEnabled, boardData]);

  // Solo mode: auto-buzz when the buzz window opens — no tap required since
  // there's no opponent to race. This lets locking immediately trigger REVEAL.
  useEffect(() => {
    if (!gameState || !playerId) return;
    if (Object.keys(gameState.players).length !== 1) return;
    if (gameState.status !== 'BUZZ_OPEN') return;
    if (gameState.buzzes.some(b => b.playerId === playerId)) return;
    dispatch({ type: 'BUZZ', playerId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.status, gameState?.activeClue?.id, playerId]);

  // Solo mode: auto-dismiss the reveal after 2.5 s. The player can still
  // swipe or use arrow keys to self-judge (and record a score) before then.
  useEffect(() => {
    if (!gameState || !playerId) return;
    if (Object.keys(gameState.players).length !== 1) return;
    if (gameState.status !== 'REVEAL' || !gameState.activeClue) return;
    const clueId = gameState.activeClue.id;
    const timer = setTimeout(() => {
      dispatch({ type: 'SKIP_CLUE', playerId, clueId });
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.status, gameState?.activeClue?.id, playerId]);

  if (!gameState || !playerId) {
    return (
      <View style={styles.connecting}>
        <Text style={styles.connectingText}>Connecting...</Text>
      </View>
    );
  }

  const onStand = judgedPlayerId(gameState);

  const disconnectedPlayerId = peerDisconnected
    ? Object.keys(gameState.players).find(id => id !== playerId) ?? null
    : null;

  // Round transition: once every Jeopardy! (round 1) clue is burned, switch
  // the board to Double Jeopardy! (round 2). Round 2 clue ids live in their
  // own range, so the two never collide and round 1 stays fully burned.
  const round1Board = boardData ? toBoardDefinition(boardData, 1) : demoBoard;
  const round1Ids = round1Board.categories.flatMap(c => c.clues.map(cl => cl.id));
  const round1Done =
    round1Ids.length > 0 && round1Ids.every(id => gameState.burnedClueIds.includes(id));
  const round2Available = !!boardData && boardData.round2.length > 0;
  const round = round1Done && round2Available ? 2 : 1;

  if (round === 2 && boardAnimKeyRef.current === 0) boardAnimKeyRef.current = 1;

  const fullBoard = boardData ? toBoardDefinition(boardData, round) : demoBoard;
  const getClue = boardData ? makeClueGetter(boardData) : getClueContent;
  const visibleBoard = getVisibleBoard(fullBoard, gameState.burnedClueIds, visibleCategories);

  // Update the Y-key handler every render so it closes over fresh state.
  yKeyHandlerRef.current = () => {
    if (gameState.activeClue) return;
    const allIds = fullBoard.categories.flatMap(c => c.clues.map(cl => cl.id));
    const unburned = allIds.filter(id => !gameState.burnedClueIds.includes(id));
    if (unburned.length <= 1) return;
    unburned.slice(0, -1).forEach(clueId => {
      dispatch({ type: 'SKIP_CLUE', playerId, clueId });
    });
  };

  // Names for the fly-by: categories beyond visibleCategories are reserve
  // categories (marked " *") that will backfill as columns clear.
  // When visibleCategories >= 6, nothing is hidden so no "*" is needed.
  const introBoard =
    introRound != null && boardData
      ? toBoardDefinition(boardData, introRound as RoundNumber)
      : null;
  const introCategories =
    introBoard?.categories.map((c, i) =>
      i >= visibleCategories ? `${c.name} *` : c.name,
    ) ?? null;

  return (
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
        <ChooseClueScreen
          state={gameState}
          localPlayerId={playerId}
          board={visibleBoard}
          disconnectedPlayerId={disconnectedPlayerId}
          boardAnimKey={boardAnimKeyRef.current}
          judgingPlayerId={gameState.status === 'REVEAL' ? onStand : null}
          onSelectClue={(clueId, rect) => {
            selectedCellRef.current = { clueId, rect };
            dispatch({
              type: 'SELECT_CLUE',
              playerId,
              clue: getClue(clueId),
            });
          }}
          onSkipClue={clueId => {
            dispatch({ type: 'SKIP_CLUE', playerId, clueId });
          }}
        />

        {peerDisconnected && !gameState.activeClue && (
          <View style={[styles.statusLineWrap, styles.rejoinWrap]}>
            <Text style={styles.statusLine}>
              {`${relayHost ?? 'localhost'}:${relayPort ?? '8787'} @ ${roomCode ?? '???'}`}
            </Text>
          </View>
        )}

        {gameState.activeClue && (
          <ExpandingClueOverlay
            key={gameState.activeClue.id}
            animate={animationsEnabled}
            bottomInset={PLAYER_BAR_HEIGHT}
            fromRect={
              selectedCellRef.current?.clueId === gameState.activeClue.id
                ? selectedCellRef.current.rect
                : null
            }
          >
            <ClueScreen
              clue={gameState.activeClue}
              canBuzz={gameState.status === 'BUZZ_OPEN' && !localBuzz}
              lights={
                gameState.status === 'BUZZ_OPEN' && !localBuzz && phaseDeadline != null
                  ? { deadline: phaseDeadline, durationMs: PHASE_TIMERS.BUZZ_OPEN!.ms, flash: true }
                  : typing && personalDeadline != null
                    ? { deadline: personalDeadline, durationMs: ANSWER_MS, flash: false }
                    : null
              }
              showKeyboard={typing}
              onSkip={() => {
                if (gameState.activeClue) dispatch({ type: 'SKIP_CLUE', playerId, clueId: gameState.activeClue.id });
              }}
              canJudge={false}
              onBuzz={() => dispatch({ type: 'BUZZ', playerId })}
              answer={localBuzz?.answer ?? ''}
              onAnswerChange={text =>
                dispatch({ type: 'SET_ANSWER', playerId, text })
              }
              onLockAnswer={text =>
                dispatch({ type: 'LOCK_ANSWER', playerId, answer: text })
              }
              reveal={
                gameState.status === 'REVEAL' || gameState.status === 'CLUE_EXPIRED'
                  ? { correctAnswer: gameState.activeClue.answer }
                  : undefined
              }
            />
          </ExpandingClueOverlay>
        )}

        {gameState.status === 'REVEAL' && onStand && (
          <JudgementTray
            key={onStand}
            players={Object.values(gameState.players)}
            localPlayerId={playerId}
            judgedPlayerId={onStand}
            answer={getBuzz(gameState, onStand)?.answer ?? ''}
            hasMoreToJudge={
              gameState.activeClue
                ? gameState.buzzes.some(
                    b => b.playerId !== onStand && !gameState.activeClue!.failedPlayerIds.includes(b.playerId)
                  )
                : false
            }
            onJudge={(correct, penalty) =>
              dispatch({
                type: 'JUDGE_ANSWER',
                playerId: onStand,
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
      </View>
    </SwipeUpMenu>
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
});
