import type { Transport } from './transport.js';
import type { Action } from './types.js';
import { createInitialState } from './reducer.js';
import { createHistory, dispatch, undo, canUndo, type GameHistory } from './history.js';

export interface GameServer {
  history: GameHistory;
  playerPeers: Map<string, string>; // peerId -> playerId
}

export function createServer(transport: Transport, playerNames: string[]): GameServer {
  const initialState = createInitialState(playerNames);
  const server: GameServer = {
    history: createHistory(initialState),
    playerPeers: new Map(),
  };

  transport.onPeerConnected((peerId) => {
    // Assign player IDs in order of connection
    const playerIds = Object.keys(server.history.current.players);
    const assignedIds = new Set(server.playerPeers.values());
    const available = playerIds.find(id => !assignedIds.has(id));
    if (available) {
      server.playerPeers.set(peerId, available);
    }
    // Send current state to the newly connected peer
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
      broadcastState(transport, server);
      return;
    }

    // Map peerId to playerId and inject it into the action
    const playerId = server.playerPeers.get(peerId);
    if (!playerId) return;

    const action = { ...parsed, playerId } as Action;
    const next = dispatch(server.history, action);

    // No-op if state didn't change
    if (next === server.history) return;

    server.history = next;
    broadcastState(transport, server);
  });

  return server;
}

function broadcastState(transport: Transport, server: GameServer): void {
  // Send each peer their own playerId along with the state
  for (const [peerId, playerId] of server.playerPeers) {
    transport.send(peerId, JSON.stringify({
      type: 'STATE_UPDATE',
      state: server.history.current,
      playerId,
    }));
  }
}
