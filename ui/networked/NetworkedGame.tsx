import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sendAction } from '../../src/client';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import type { WebSocketTransport } from '../../src/webSocketTransport';
import type { Action, GameState, GameStatus } from '../../src/types';
import { SwipeUpMenu } from '../components/SwipeUpMenu';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { MainMenuScreen } from '../screens/MainMenuScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';
import { colors, type as typeTokens } from '../theme/tokens';

interface NetworkedGameProps {
  transport: WebSocketTransport;
  serverPeerId: string;
  initialState?: { state: GameState; playerId: string | null } | null;
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

export function NetworkedGame({ transport, serverPeerId, initialState, peerDisconnected, roomCode, relayHost, relayPort, onLeave, onNewGame, onJoinGame, playerName, onNameChange, relayHostSetting, onRelayHostChange, relayPortSetting, onRelayPortChange }: NetworkedGameProps) {
  // createClient is called in App.tsx before this component mounts, so
  // STATE_UPDATE messages are never lost. App.tsx passes the latest state
  // down as initialState (updated on every STATE_UPDATE from the server).
  const gameState = initialState?.state ?? null;
  const playerId = initialState?.playerId ?? null;
  const [countdown, setCountdown] = useState<number | null>(null);
  const [personalCountdown, setPersonalCountdown] = useState<number | null>(null);

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
          board={demoBoard}
          disconnectedPlayerId={disconnectedPlayerId}
          onSelectClue={clueId => {
            dispatch({
              type: 'SELECT_CLUE',
              playerId,
              clue: getClueContent(clueId),
            });
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
          <View style={StyleSheet.absoluteFill}>
            <ClueScreen
              clue={gameState.activeClue}
              statusText={statusLine(gameState, playerId, countdown, typing ? personalCountdown : null)}
              canBuzz={gameState.status === 'BUZZ_OPEN' && !localBuzz}
              showKeyboard={typing}
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
          </View>
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
