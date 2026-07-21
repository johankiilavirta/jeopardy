import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '../mockTransport.js';
import { createServer, type Timer } from '../server.js';
import { createClient, sendAction } from '../client.js';
import { createInitialState, reducer } from '../reducer.js';
import type { GameState } from '../types.js';

function createMockTimer() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timer: Timer = {
    set: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
    clear: (id) => { pending.delete(id as number); },
  };
  return {
    timer,
    fire: (index = 0) => {
      const entry = [...pending.entries()][index];
      if (!entry) throw new Error(`no pending timer at index ${index}`);
      pending.delete(entry[0]);
      entry[1]();
    },
  };
}

describe('GameClient', () => {
  it('receives state on connect', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const onUpdate = vi.fn();
    const client = createClient(p1, onUpdate);
    MockTransport.link(host, p1);

    expect(client.state).not.toBeNull();
    expect(client.state!.status).toBe('CHOOSE_CLUE');
    expect(client.playerId).toBe('alice');
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('receives state updates when actions are processed', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const client1 = createClient(p1);
    const client2 = createClient(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    sendAction(p1, 'host', {
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    });

    expect(client1.state!.status).toBe('CLUE_READING');
    expect(client2.state!.status).toBe('CLUE_READING');
  });

  it('sendAction sends to server', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const client = createClient(p1);
    MockTransport.link(host, p1);

    sendAction(p1, 'host', {
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    });

    expect(client.state!.status).toBe('CLUE_READING');
  });

  it('ignores non-STATE_UPDATE messages', () => {
    const p1 = new MockTransport('player1');
    const client = createClient(p1);

    const other = new MockTransport('other');
    MockTransport.link(p1, other);
    other.send('player1', JSON.stringify({ type: 'UNKNOWN' }));

    expect(client.state).toBeNull();
  });

  it('full round trip: select, buzz, judge', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const client1 = createClient(p1);
    const client2 = createClient(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    // Alice selects
    sendAction(p1, 'host', {
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 400 },
    });
    expect(client1.state!.status).toBe('CLUE_READING');

    // Reading lockout ends, buzz window opens
    fire();
    expect(client1.state!.status).toBe('BUZZ_OPEN');

    // Bob buzzes and types — both clients see his draft sync
    sendAction(p2, 'host', { type: 'BUZZ' });
    expect(client2.state!.buzzes[0]!.playerId).toBe('bob');

    sendAction(p2, 'host', { type: 'SET_ANSWER', text: 'PLUTO' });
    expect(client1.state!.buzzes[0]!.answer).toBe('PLUTO');

    // Bob locks in; the window expires with alice never buzzing → REVEAL
    sendAction(p2, 'host', { type: 'LOCK_ANSWER', answer: 'PLUTO' });
    fire(); // window TIMEOUT
    expect(client1.state!.status).toBe('REVEAL');

    // Bob judges himself correct
    sendAction(p2, 'host', { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });
    expect(client1.state!.players['bob']!.score).toBe(400);
    expect(client2.state!.currentTurnPlayerId).toBe('bob');
  });
});

describe('ANSWER_UPDATE handling', () => {
  /** A state mid-clue with bob buzzed in and typing. */
  function answeringState(): GameState {
    let s = createInitialState(['Alice', 'Bob'], 6);
    s = reducer(s, {
      type: 'SELECT_CLUE',
      playerId: 'alice',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
    });
    s = reducer(s, { type: 'BUZZER_OPEN' });
    return reducer(s, { type: 'BUZZ', playerId: 'bob' });
  }

  function rawClient() {
    const p1 = new MockTransport('player1');
    const onUpdate = vi.fn();
    const client = createClient(p1, onUpdate);
    const server = new MockTransport('server');
    MockTransport.link(p1, server);
    const push = (msg: Record<string, unknown>) => server.send('player1', JSON.stringify(msg));
    return { client, onUpdate, push };
  }

  it('applies a delta to the current state, repeating the last snapshot undo flags', () => {
    const { client, onUpdate, push } = rawClient();
    push({ type: 'STATE_UPDATE', state: answeringState(), playerId: 'alice', canUndo: true, canRedo: false });

    push({ type: 'ANSWER_UPDATE', playerId: 'bob', clueId: 1, text: 'PLU' });

    expect(client.state!.buzzes[0]!.answer).toBe('PLU');
    expect(client.playerId).toBe('alice');
    expect(onUpdate).toHaveBeenLastCalledWith(client.state, 'alice', true, false);
  });

  it('drops a delta whose clue id does not match the active clue', () => {
    const { client, onUpdate, push } = rawClient();
    push({ type: 'STATE_UPDATE', state: answeringState(), playerId: 'alice', canUndo: true, canRedo: false });
    onUpdate.mockClear();

    push({ type: 'ANSWER_UPDATE', playerId: 'bob', clueId: 99, text: 'STALE' });

    expect(client.state!.buzzes[0]!.answer).toBe('');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('drops a delta for a locked buzz (same guard as the server reducer)', () => {
    const { client, onUpdate, push } = rawClient();
    const locked = reducer(answeringState(), { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'PLUTO' });
    push({ type: 'STATE_UPDATE', state: locked, playerId: 'alice' });
    onUpdate.mockClear();

    push({ type: 'ANSWER_UPDATE', playerId: 'bob', clueId: 1, text: 'LATE' });

    expect(client.state!.buzzes[0]!.answer).toBe('PLUTO');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('ignores a delta arriving before any snapshot', () => {
    const { client, onUpdate, push } = rawClient();
    push({ type: 'ANSWER_UPDATE', playerId: 'bob', clueId: 1, text: 'PLU' });
    expect(client.state).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
