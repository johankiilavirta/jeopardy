import type { Transport } from './transport.js';
import type { Action } from './types.js';
import { createInitialState } from './reducer.js';
import { createHistory, dispatch, undo, canUndo, type GameHistory } from './history.js';

export interface Timer {
  set(cb: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const defaultTimer: Timer = {
  set: (cb, ms) => setTimeout(cb, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface GameServer {
  history: GameHistory;
  playerPeers: Map<string, string>; // peerId -> playerId
}

export interface ServerOptions {
  timer?: Timer;
  buzzerMs?: number;
}

export function createServer(
  transport: Transport,
  playerNames: string[],
  options: ServerOptions = {},
): GameServer {
  const { timer = defaultTimer, buzzerMs = 5000 } = options;
  const initialState = createInitialState(playerNames);
  const server: GameServer = {
    history: createHistory(initialState),
    playerPeers: new Map(),
  };

  let buzzerTimerId: unknown = null;

  function clearBuzzerTimer(): void {
    if (buzzerTimerId != null) {
      timer.clear(buzzerTimerId);
      buzzerTimerId = null;
    }
  }

  function startBuzzerTimer(): void {
    clearBuzzerTimer();
    buzzerTimerId = timer.set(() => {
      const timeoutAction: Action = { type: 'TIMEOUT' };
      const next = dispatch(server.history, timeoutAction);
      if (next !== server.history) {
        server.history = next;
        clearBuzzerTimer();
        broadcastState(transport, server);
      }
    }, buzzerMs);
  }

  function handleStateTransition(prevStatus: string): void {
    const newStatus = server.history.current.status;
    if (newStatus === 'CLUE_READING' && prevStatus !== 'CLUE_READING') {
      startBuzzerTimer();
    } else if (newStatus === 'CLUE_READING' && prevStatus === 'CLUE_READING') {
      // Someone failed, timer restarts for remaining players
      startBuzzerTimer();
    } else if (newStatus !== 'CLUE_READING') {
      clearBuzzerTimer();
    }
  }

  transport.onPeerConnected((peerId) => {
    const playerIds = Object.keys(server.history.current.players);
    const assignedIds = new Set(server.playerPeers.values());
    const available = playerIds.find(id => !assignedIds.has(id));
    if (available) {
      server.playerPeers.set(peerId, available);
    }
    transport.send(peerId, JSON.stringify({
      type: 'STATE_UPDATE',
      state: server.history.current,
      playerId: server.playerPeers.get(peerId) ?? null,
    }));
  });

  transport.onMessage((peerId, message) => {
    let parsed: { type: string };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const prevStatus = server.history.current.status;

    if (parsed.type === 'UNDO') {
      if (!canUndo(server.history)) return;
      server.history = undo(server.history);
      handleStateTransition(prevStatus);
      broadcastState(transport, server);
      return;
    }

    const playerId = server.playerPeers.get(peerId);
    if (!playerId) return;

    const action = { ...parsed, playerId } as Action;
    const next = dispatch(server.history, action);

    if (next === server.history) return;

    server.history = next;
    handleStateTransition(prevStatus);
    broadcastState(transport, server);
  });

  return server;
}

function broadcastState(transport: Transport, server: GameServer): void {
  for (const [peerId, playerId] of server.playerPeers) {
    transport.send(peerId, JSON.stringify({
      type: 'STATE_UPDATE',
      state: server.history.current,
      playerId,
    }));
  }
}
