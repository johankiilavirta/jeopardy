import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';
import { createInitialState, normalizeForResume } from '../reducer.js';
import type { Transport } from '../transport.js';
import type { GameState } from '../types.js';

/** Minimal server-side transport that can connect peers with player names
 *  (MockTransport.link doesn't carry names) and records sends per peer. */
class StubTransport implements Transport {
  sent: Record<string, string[]> = {};
  private connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];

  advertise(): void {}
  discover(): void {}
  stop(): void {}
  send(peerId: string, message: string): void {
    (this.sent[peerId] ??= []).push(message);
  }
  broadcast(message: string): void {
    for (const peerId of Object.keys(this.sent)) this.send(peerId, message);
  }
  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void { this.connectCbs.push(cb); }
  onPeerDisconnected(): void {}
  onMessage(cb: (peerId: string, message: string) => void): void { this.messageCbs.push(cb); }

  connect(peerId: string, playerName?: string): void {
    this.sent[peerId] ??= [];
    this.connectCbs.forEach(cb => cb(peerId, playerName));
  }
  deliver(peerId: string, message: object): void {
    this.messageCbs.forEach(cb => cb(peerId, JSON.stringify(message)));
  }
  lastStateFor(peerId: string): { state: GameState; playerId: string | null } {
    const msgs = this.sent[peerId]!;
    return JSON.parse(msgs[msgs.length - 1]!);
  }
}

function midGameState(): GameState {
  return {
    ...createInitialState(['Alice', 'Bob'], 25),
    players: {
      alice: { id: 'alice', name: 'Alice', score: 800 },
      bob: { id: 'bob', name: 'Bob', score: -200 },
    },
    currentTurnPlayerId: 'bob',
    burnedClueIds: [0, 1, 5],
  };
}

describe('resuming from a saved state', () => {
  it('starts from the provided state instead of a fresh board', () => {
    const transport = new StubTransport();
    const server = createServer(transport, [], { initialState: midGameState() });

    expect(server.history.current.players['alice']?.score).toBe(800);
    expect(server.history.current.burnedClueIds).toEqual([0, 1, 5]);
    expect(server.history.current.currentTurnPlayerId).toBe('bob');
  });

  it('reattaches connecting peers to their seats by name', () => {
    const transport = new StubTransport();
    createServer(transport, [], { initialState: midGameState() });

    transport.connect('peer-9', 'Bob');
    const { state, playerId } = transport.lastStateFor('peer-9');
    expect(playerId).toBe('bob');
    expect(state.players['bob']?.score).toBe(-200);
  });

  it('enforces the resumed turn and rejects burned clues', () => {
    const transport = new StubTransport();
    const server = createServer(transport, [], { initialState: midGameState() });
    transport.connect('peer-1', 'Alice');
    transport.connect('peer-2', 'Bob');

    const clue = { id: 5, category: 'C', text: 'Q', answer: 'A', value: 200 };
    // Burned clue: rejected even for the turn holder
    transport.deliver('peer-2', { type: 'SELECT_CLUE', clue });
    expect(server.history.current.status).toBe('CHOOSE_CLUE');
    // It's Bob's turn — Alice can't pick
    transport.deliver('peer-1', { type: 'SELECT_CLUE', clue: { ...clue, id: 7 } });
    expect(server.history.current.status).toBe('CHOOSE_CLUE');
    // Bob picks an unburned clue and play continues
    transport.deliver('peer-2', { type: 'SELECT_CLUE', clue: { ...clue, id: 7 } });
    expect(server.history.current.status).toBe('CLUE_READING');
  });
});

describe('normalizeForResume', () => {
  it('abandons an in-flight clue and returns to the board', () => {
    const state: GameState = {
      ...midGameState(),
      status: 'ANSWERING',
      activeClue: { id: 7, category: 'C', text: 'Q', answer: 'A', value: 200, failedPlayerIds: [] },
      clueSelectPlayerId: 'alice',
      buzzes: [{ playerId: 'alice', answer: 'wip', locked: false }],
    };

    const resumed = normalizeForResume(state);
    expect(resumed.status).toBe('CHOOSE_CLUE');
    expect(resumed.activeClue).toBeNull();
    expect(resumed.buzzes).toEqual([]);
    // The unfinished clue is NOT burned — it can be picked again
    expect(resumed.burnedClueIds).toEqual([0, 1, 5]);
    // Scores and turn survive
    expect(resumed.players['alice']?.score).toBe(800);
    expect(resumed.currentTurnPlayerId).toBe('bob');
  });

  it('passes a board-phase state through untouched', () => {
    const state = midGameState();
    expect(normalizeForResume(state)).toBe(state);
  });
});
