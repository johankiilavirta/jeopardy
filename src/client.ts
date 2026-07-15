import type { Transport } from './transport.js';
import type { GameState } from './types.js';

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

  transport.onMessage((_peerId, message) => {
    let parsed: { type: string; state?: GameState; playerId?: string; canUndo?: boolean; canRedo?: boolean };
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    if (parsed.type === 'STATE_UPDATE' && parsed.state) {
      client.state = parsed.state;
      client.playerId = parsed.playerId ?? null;
      onStateUpdate?.(client.state, client.playerId, parsed.canUndo, parsed.canRedo);
    }
  });

  return client;
}

export function sendAction(transport: Transport, serverPeerId: string, action: Record<string, unknown>): void {
  transport.send(serverPeerId, JSON.stringify(action));
}
