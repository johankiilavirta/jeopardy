import type { Transport } from './transport.js';
import type { GameState } from './types.js';
import { reducer } from './reducer.js';

export interface GameClient {
  /** Current game state (null until first state update from server) */
  state: GameState | null;
  /** This client's player ID (null until assigned by server) */
  playerId: string | null;
}

export function createClient(
  transport: Transport,
  onStateUpdate?: (state: GameState, playerId: string | null, canUndo?: boolean, canRedo?: boolean) => void,
): GameClient {
  const client: GameClient = {
    state: null,
    playerId: null,
  };

  // ANSWER_UPDATE deltas don't carry undo flags (typing is transient and
  // never changes them) — repeat the flags from the last full snapshot so
  // the UI's undo buttons don't flicker while someone types.
  let lastCanUndo: boolean | undefined;
  let lastCanRedo: boolean | undefined;

  transport.onMessage((_peerId, message) => {
    let parsed: {
      type: string;
      state?: GameState;
      playerId?: string;
      canUndo?: boolean;
      canRedo?: boolean;
      clueId?: number;
      text?: string;
    };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (parsed.type === 'STATE_UPDATE' && parsed.state) {
      client.state = parsed.state;
      client.playerId = parsed.playerId ?? null;
      lastCanUndo = parsed.canUndo;
      lastCanRedo = parsed.canRedo;
      onStateUpdate?.(client.state, client.playerId, parsed.canUndo, parsed.canRedo);
      return;
    }

    // Typing delta: the server sends one player's current answer text
    // instead of a full snapshot. Applied through the same reducer as the
    // server, so guards (status, locked buzz) match exactly; the clue id
    // check drops any delta that outlived its clue.
    if (parsed.type === 'ANSWER_UPDATE' && parsed.playerId != null && parsed.text != null) {
      if (!client.state || client.state.activeClue?.id !== parsed.clueId) return;
      const next = reducer(client.state, {
        type: 'SET_ANSWER',
        playerId: parsed.playerId,
        text: parsed.text,
      });
      if (next === client.state) return;
      client.state = next;
      onStateUpdate?.(client.state, client.playerId, lastCanUndo, lastCanRedo);
    }
  });

  return client;
}

export function sendAction(transport: Transport, serverPeerId: string, action: Record<string, unknown>): void {
  transport.send(serverPeerId, JSON.stringify(action));
}
