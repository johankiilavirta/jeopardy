import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '../mockTransport.js';
import { createServer } from '../server.js';
import type { GameState } from '../types.js';

function lastStateFrom(messages: [string, string][]): { state: GameState; playerId: string } {
  const last = messages[messages.length - 1]!;
  return JSON.parse(last[1]);
}

function captureMessages(transport: MockTransport): [string, string][] {
  const messages: [string, string][] = [];
  transport.onMessage((from, msg) => messages.push([from, msg]));
  return messages;
}

describe('GameServer', () => {
  it('assigns players on connect and sends initial state', () => {
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);

    expect(server.playerPeers.get('player1')).toBe('alice');
    const msg = lastStateFrom(p1Messages);
    expect(msg.state.status).toBe('CHOOSE_CLUE');
    expect(msg.playerId).toBe('alice');
  });

  it('assigns second player to remaining slot', () => {
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    expect(server.playerPeers.get('player1')).toBe('alice');
    expect(server.playerPeers.get('player2')).toBe('bob');
  });

  it('processes actions and broadcasts state to all peers', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    const p2Messages = captureMessages(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    // Player 1 (alice) selects a clue
    p1.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    }));

    const p1State = lastStateFrom(p1Messages);
    const p2State = lastStateFrom(p2Messages);
    expect(p1State.state.status).toBe('CLUE_READING');
    expect(p2State.state.status).toBe('CLUE_READING');
    expect(p1State.playerId).toBe('alice');
    expect(p2State.playerId).toBe('bob');
  });

  it('injects playerId from peer mapping, ignores client-provided playerId', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);

    // Client tries to act as bob, but they're mapped to alice
    p1.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      playerId: 'bob',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    }));

    const state = lastStateFrom(p1Messages);
    // Should work because server overrides playerId to 'alice'
    expect(state.state.status).toBe('CLUE_READING');
    expect(state.state.clueSelectPlayerId).toBe('alice');
  });

  it('ignores invalid JSON', () => {
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    MockTransport.link(host, p1);

    p1.send('host', 'not json!!!');
    expect(server.history.current.status).toBe('CHOOSE_CLUE');
  });

  it('ignores actions from unknown peers', () => {
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob']);

    // Third peer connects but has no player slot
    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p3 = new MockTransport('player3');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);
    MockTransport.link(host, p3);

    p3.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    }));

    expect(server.history.current.status).toBe('CHOOSE_CLUE');
  });

  it('handles undo', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);

    p1.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    }));

    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_READING');

    p1.send('host', JSON.stringify({ type: 'UNDO' }));

    expect(lastStateFrom(p1Messages).state.status).toBe('CHOOSE_CLUE');
  });

  it('full game flow: select, buzz, judge correct', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    const p2Messages = captureMessages(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    // Alice selects clue
    p1.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 400 },
    }));

    // Bob buzzes
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(lastStateFrom(p2Messages).state.answeringPlayerId).toBe('bob');

    // Bob judges correct
    p2.send('host', JSON.stringify({ type: 'JUDGE_ANSWER', correct: true }));

    const finalState = lastStateFrom(p1Messages).state;
    expect(finalState.status).toBe('CHOOSE_CLUE');
    expect(finalState.players['bob']!.score).toBe(400);
    expect(finalState.currentTurnPlayerId).toBe('bob');
    expect(finalState.burnedClueIds).toContain(1);
  });
});
