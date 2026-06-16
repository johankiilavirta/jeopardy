import Constants from 'expo-constants';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createClient, sendAction } from '../../src/client';
import { getBuzz, judgedPlayerId } from '../../src/reducer';
import { WebSocketTransport } from '../../src/webSocketTransport';
import type { Action, GameState, GameStatus } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';
import { colors, type as typeTokens } from '../theme/tokens';

const extra = Constants.expoConfig?.extra as { relayHost?: string } | undefined;
const RELAY_HOST = extra?.relayHost ?? 'localhost';
const RELAY_URL = `ws://${RELAY_HOST}:8787`;

/** The server is always the first peer to connect to the relay. */
const SERVER_PEER_ID = 'peer-1';

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

export function NetworkedGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [personalCountdown, setPersonalCountdown] = useState<number | null>(null);
  const transportRef = useRef<WebSocketTransport | null>(null);

  useEffect(() => {
    const transport = new WebSocketTransport(RELAY_URL);
    transportRef.current = transport;

    createClient(transport, (state, pid) => {
      setGameState(state);
      setPlayerId(pid);
    });

    return () => { transport.stop(); };
  }, []);

  const dispatch = (action: Action) => {
    if (transportRef.current) {
      sendAction(transportRef.current, SERVER_PEER_ID, action as unknown as Record<string, unknown>);
    }
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

  return (
    <View style={styles.root}>
      <ChooseClueScreen
        state={gameState}
        localPlayerId={playerId}
        board={demoBoard}
        onSelectClue={clueId => {
          dispatch({
            type: 'SELECT_CLUE',
            playerId,
            clue: getClueContent(clueId),
          });
        }}
      />

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
});
