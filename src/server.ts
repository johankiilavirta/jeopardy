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
  /** How long each buzzed player can type (from their own buzz) before input locks */
  answerMs?: number;
}

/** Actions clients are allowed to send. Timer actions are server-only. */
const CLIENT_ACTIONS = new Set(['SELECT_CLUE', 'BUZZ', 'SET_ANSWER', 'LOCK_ANSWER', 'JUDGE_ANSWER']);

export function createServer(
  transport: Transport,
  playerNames: string[],
  options: ServerOptions = {},
): GameServer {
  const {
    timer = defaultTimer,
    readingMs = 5000,
    buzzerMs = 5000,
    dismissMs = 5000,
    answerMs = 10000,
  } = options;
  const initialState = createInitialState(playerNames);
  const server: GameServer = {
    history: createHistory(initialState),
    playerPeers: new Map(),
  };

  let phaseTimerId: unknown = null;

  /** One personal typing timer per unlocked buzzer (playerId → timer id). */
  const answerTimerIds = new Map<string, unknown>();

  function clearPhaseTimer(): void {
    if (phaseTimerId != null) {
      timer.clear(phaseTimerId);
      phaseTimerId = null;
    }
  }

  function clearAnswerTimers(): void {
    for (const id of answerTimerIds.values()) timer.clear(id);
    answerTimerIds.clear();
  }

  /** Arm (or disarm) the phase timer based on the current status. Called
   *  only when the status changed (the phases are sequential and never
   *  re-enter themselves), so mid-phase actions like BUZZ or SET_ANSWER
   *  never reset a running window. At most one phase timer is pending. */
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
      // ANSWERING and REVEAL are not phase-timed: ANSWERING ends via the
      // personal answer timers below, REVEAL via manual judging.
    }
  }

  /** Differentially reconcile personal typing timers with the buzz list:
   *  each unlocked buzzer gets one answerMs timer armed at buzz time and
   *  never reset; locked (or judged-away) entries are cleared. The timer
   *  fires a LOCK_ANSWER without text — the last synced answer stands. */
  function syncAnswerTimers(): void {
    const state = server.history.current;
    if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING') {
      clearAnswerTimers();
      return;
    }
    for (const [playerId, id] of answerTimerIds) {
      const buzz = state.buzzes.find(b => b.playerId === playerId);
      if (!buzz || buzz.locked) {
        timer.clear(id);
        answerTimerIds.delete(playerId);
      }
    }
    for (const buzz of state.buzzes) {
      if (!buzz.locked && !answerTimerIds.has(buzz.playerId)) {
        const playerId = buzz.playerId;
        answerTimerIds.set(playerId, timer.set(() => {
          answerTimerIds.delete(playerId);
          applyAction({ type: 'LOCK_ANSWER', playerId });
        }, answerMs));
      }
    }
  }

  /** Unified post-dispatch path: phase timer re-arms only on a status
   *  change, answer timers reconcile differentially, then broadcast. */
  function applyAction(action: Action, opts: { transient?: boolean } = {}): void {
    const prevStatus = server.history.current.status;
    const next = dispatch(server.history, action, opts);
    if (next === server.history) return;
    server.history = next;
    if (server.history.current.status !== prevStatus) armPhaseTimer();
    syncAnswerTimers();
    broadcastState(transport, server);
  }

  function fireTimerAction(action: Action): void {
    phaseTimerId = null;
    applyAction(action);
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
      // Rebuild all timers fresh — after an undo they restart from zero
      // (the state carries no timestamps; documented tradeoff).
      clearPhaseTimer();
      clearAnswerTimers();
      armPhaseTimer();
      syncAnswerTimers();
      broadcastState(transport, server);
      return;
    }

    // Clients may only send player actions — timer actions are server-only
    if (!CLIENT_ACTIONS.has(parsed.type)) return;

    const playerId = server.playerPeers.get(peerId);
    if (!playerId) return;

    // playerId comes from the peer mapping, so you can only ever buzz,
    // type, lock and judge as yourself.
    const action = { ...parsed, playerId } as Action;
    // Keystrokes are transient: they update state without growing the
    // undo stack.
    applyAction(action, { transient: action.type === 'SET_ANSWER' });
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
