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
  /** Reading lockout: time before the buzz window opens */
  readingMs?: number;
  /** How long the buzz window stays open */
  buzzerMs?: number;
  /** How long an expired clue lingers before returning to the board */
  dismissMs?: number;
}

/** Actions clients are allowed to send. Timer actions are server-only. */
const CLIENT_ACTIONS = new Set(['SELECT_CLUE', 'BUZZ', 'JUDGE_ANSWER']);

export function createServer(
  transport: Transport,
  playerNames: string[],
  options: ServerOptions = {},
): GameServer {
  const { timer = defaultTimer, readingMs = 5000, buzzerMs = 5000, dismissMs = 3000 } = options;
  const initialState = createInitialState(playerNames);
  const server: GameServer = {
    history: createHistory(initialState),
    playerPeers: new Map(),
  };

  let phaseTimerId: unknown = null;

  function clearPhaseTimer(): void {
    if (phaseTimerId != null) {
      timer.clear(phaseTimerId);
      phaseTimerId = null;
    }
  }

  function fireTimerAction(action: Action): void {
    phaseTimerId = null;
    const next = dispatch(server.history, action);
    if (next === server.history) return;
    server.history = next;
    armPhaseTimer();
    broadcastState(transport, server);
  }

  /** Arm (or disarm) the phase timer based on the current status.
   *  Called after every applied state change, so undoing into a timed
   *  phase restarts its timer automatically. The phases are sequential,
   *  so there's at most one pending timer. */
  function armPhaseTimer(): void {
    clearPhaseTimer();
    switch (server.history.current.status) {
      case 'CLUE_READING':
        phaseTimerId = timer.set(() => fireTimerAction({ type: 'BUZZER_OPEN' }), readingMs);
        break;
      case 'BUZZ_OPEN':
        phaseTimerId = timer.set(() => fireTimerAction({ type: 'TIMEOUT' }), buzzerMs);
        break;
      case 'CLUE_EXPIRED':
        phaseTimerId = timer.set(() => fireTimerAction({ type: 'DISMISS_CLUE' }), dismissMs);
        break;
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

    if (parsed.type === 'UNDO') {
      if (!canUndo(server.history)) return;
      server.history = undo(server.history);
      armPhaseTimer();
      broadcastState(transport, server);
      return;
    }

    // Clients may only send player actions — timer actions are server-only
    if (!CLIENT_ACTIONS.has(parsed.type)) return;

    const playerId = server.playerPeers.get(peerId);
    if (!playerId) return;

    const action = { ...parsed, playerId } as Action;
    const next = dispatch(server.history, action);

    if (next === server.history) return;

    server.history = next;
    armPhaseTimer();
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
