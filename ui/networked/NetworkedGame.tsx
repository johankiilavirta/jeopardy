import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sendAction } from '../../src/client';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import type { WebSocketTransport } from '../../src/webSocketTransport';
import type { Action, GameState, GameStatus } from '../../src/types';
import type { CellRect } from '../components/BoardCell';
import { CategoryIntro } from '../components/CategoryIntro';
import { ExpandingClueOverlay } from '../components/ExpandingClueOverlay';
import { SwipeUpMenu } from '../components/SwipeUpMenu';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { toBoardDefinition, makeClueGetter, getVisibleBoard } from '../../data/gameLoader';
import type { GameData, RoundNumber } from '../../data/gameLoader';
import { MainMenuScreen } from '../screens/MainMenuScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
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
}

const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number }>> = {
  CLUE_READING: { ms: 5000 },
  BUZZ_OPEN: { ms: 5000 },
  CLUE_EXPIRED: { ms: 5000 },
};

const ANSWER_MS = 10000;

function statusLine(
  state: GameState,
  localPlayerId: string,
  countdown: number | null,
  personalCountdown: number | null,
): string | null {
  switch (state.status) {
    case 'CLUE_READING':
      return `Wait to buzz ${PHASE_TIMERS.CLUE_READING!.ms / 1000}s`;
    case 'BUZZ_OPEN':
    case 'ANSWERING':
      return `${(personalCountdown ?? countdown) ?? 0}s`;
    case 'REVEAL': {
      const onStand = judgedPlayerId(state);
      const name = state.players[onStand ?? '']?.name ?? 'Someone';
      const text = onStand ? getBuzz(state, onStand)?.answer : '';
      return `${name} ANSWERED ${text ? `"${text}"` : 'NOTHING'}`.toUpperCase();
    }
    case 'CLUE_EXPIRED':
      return 'Time to answer expired';
    default:
      return null;
  }
}

export function NetworkedGame({ transport, serverPeerId, initialState, boardData, peerDisconnected, roomCode, relayHost, relayPort, onLeave, onNewGame, onJoinGame, playerName, onNameChange, relayHostSetting, onRelayHostChange, relayPortSetting, onRelayPortChange, animationsEnabled = true }: NetworkedGameProps) {
  // createClient is called in App.tsx before this component mounts, so
  // STATE_UPDATE messages are never lost. App.tsx passes the latest state
  // down as initialState (updated on every STATE_UPDATE from the server).
  const gameState = initialState?.state ?? null;
  const playerId = initialState?.playerId ?? null;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [personalCountdown, setPersonalCountdown] = useState<number | null>(null);
  // Window rect of the cell this device last tapped, so the clue card can grow
  // out of it. Only set for clues *we* picked — a clue another player selects
  // arrives with no rect and simply appears full-screen.
  const selectedCellRef = useRef<{ clueId: number; rect: CellRect } | null>(null);
  // Category fly-by: each round plays its intro once, before the board is
  // usable. We track which rounds have already shown theirs so the intro never
  // replays (e.g. on a reconnect / state update).
  const introShownRef = useRef<Set<number>>(new Set());
  const [introRound, setIntroRound] = useState<number | null>(null);

  const dispatch = (action: Action) => {
    sendAction(transport, serverPeerId, action as unknown as Record<string, unknown>);
  };

  // Phase countdown timers (display-only, server is authoritative).
  useEffect(() => {
    if (!gameState) return;
    const phase = PHASE_TIMERS[gameState.status];
    if (!phase) {
      setCountdown(null);
      return;
    }
    const deadline = Date.now() + phase.ms;
    setCountdown(Math.ceil(phase.ms / 1000));
    const tick = setInterval(() => {
      setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(tick);
  }, [gameState?.status]);

  const localBuzz = gameState && playerId ? getBuzz(gameState, playerId) : undefined;
  const typing =
    !!localBuzz &&
    !localBuzz.locked &&
    (gameState?.status === 'BUZZ_OPEN' || gameState?.status === 'ANSWERING');

  // Personal typing timer (display-only).
  useEffect(() => {
    if (!typing) {
      setPersonalCountdown(null);
      return;
    }
    const deadline = Date.now() + ANSWER_MS;
    setPersonalCountdown(Math.ceil(ANSWER_MS / 1000));
    const tick = setInterval(() => {
      setPersonalCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(tick);
  }, [typing]);

  // Play the category fly-by once at the start of round 1 only. Round 2
  // (Double Jeopardy) transitions silently — no intro animation.
  useEffect(() => {
    if (!animationsEnabled || !boardData) return;
    if (introShownRef.current.has(1)) return;
    introShownRef.current.add(1);
    setIntroRound(1);
  }, [animationsEnabled, boardData]);

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

  const fullBoard = boardData ? toBoardDefinition(boardData, round) : demoBoard;
  const getClue = boardData ? makeClueGetter(boardData) : getClueContent;
  const visibleBoard = getVisibleBoard(fullBoard, gameState.burnedClueIds);

  // Names for the fly-by: all categories of the queued round, with the 6th
  // (backfilled, non-displayed-at-start) category marked with a trailing " *".
  const introBoard =
    introRound != null && boardData
      ? toBoardDefinition(boardData, introRound as RoundNumber)
      : null;
  const introCategories =
    introBoard?.categories.map((c, i) => (i === 5 ? `${c.name} *` : c.name)) ?? null;

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
      renderSettings={goBack => (
        <SettingsScreen
          playerName={playerName ?? ''}
          onNameChange={onNameChange ?? (() => {})}
          relayHost={relayHostSetting ?? relayHost ?? 'localhost'}
          onRelayHostChange={onRelayHostChange ?? (() => {})}
          relayPort={relayPortSetting ?? relayPort ?? '8787'}
          onRelayPortChange={onRelayPortChange ?? (() => {})}
          onBack={goBack}
        />
      )}
    >
      <View style={styles.root}>
        <ChooseClueScreen
          state={gameState}
          localPlayerId={playerId}
          board={visibleBoard}
          disconnectedPlayerId={disconnectedPlayerId}
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
            fromRect={
              selectedCellRef.current?.clueId === gameState.activeClue.id
                ? selectedCellRef.current.rect
                : null
            }
          >
            <ClueScreen
              clue={gameState.activeClue}
              statusText={statusLine(gameState, playerId, countdown, typing ? personalCountdown : null)}
              canBuzz={gameState.status === 'BUZZ_OPEN' && !localBuzz}
              showKeyboard={typing}
              onSkip={() => {
                if (gameState.activeClue) dispatch({ type: 'SKIP_CLUE', playerId, clueId: gameState.activeClue.id });
              }}
              canJudge={gameState.status === 'REVEAL'}
              onBuzz={() => dispatch({ type: 'BUZZ', playerId })}
              onJudge={correct => {
                if (onStand) dispatch({ type: 'JUDGE_ANSWER', playerId: onStand, correct });
              }}
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
