import { describe, it, expect } from 'vitest';
import { MockTransport } from '../mockTransport.js';
import { createServer, type Timer } from '../server.js';
import type { GameState } from '../types.js';

function createMockTimer() {
  let callback: (() => void) | null = null;
  let lastMs: number | null = null;
  let id = 0;
  const timer: Timer = {
    set: (cb, ms) => { callback = cb; lastMs = ms; return ++id; },
    clear: () => { callback = null; lastMs = null; },
  };
  return {
    timer,
    fire: () => {
      const cb = callback;
      callback = null;
      lastMs = null;
      cb?.();
    },
    armedMs: () => lastMs,
  };
}

function lastStateFrom(messages: [string, string][]): { state: GameState; playerId: string } {
  const last = messages[messages.length - 1]!;
  return JSON.parse(last[1]);
}

function captureMessages(transport: MockTransport): [string, string][] {
  const messages: [string, string][] = [];
  transport.onMessage((from, msg) => messages.push([from, msg]));
  return messages;
}

const selectClueMsg = JSON.stringify({
  type: 'SELECT_CLUE',
  clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 200 },
});

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
    p1.send('host', selectClueMsg);

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

    p3.send('host', selectClueMsg);

    expect(server.history.current.status).toBe('CHOOSE_CLUE');
  });

  it('ignores client-sent timer actions (TIMEOUT, BUZZER_OPEN, DISMISS_CLUE, LOCK_ANSWER)', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    MockTransport.link(host, p1);
    MockTransport.link(host, new MockTransport('player2'));

    p1.send('host', selectClueMsg);
    expect(server.history.current.status).toBe('CLUE_READING');

    // A client can't skip the reading lockout...
    p1.send('host', JSON.stringify({ type: 'BUZZER_OPEN' }));
    expect(server.history.current.status).toBe('CLUE_READING');

    fire(); // legit server timer opens the window
    expect(server.history.current.status).toBe('BUZZ_OPEN');

    // ...nor lock an opponent's answer early...
    p1.send('host', JSON.stringify({ type: 'BUZZ' }));
    p1.send('host', JSON.stringify({ type: 'LOCK_ANSWER' }));
    expect(server.history.current.status).toBe('ANSWER_PHASE');
    p1.send('host', JSON.stringify({ type: 'UNDO' })); // back to BUZZ_OPEN

    // ...nor force an expiry...
    p1.send('host', JSON.stringify({ type: 'TIMEOUT' }));
    expect(server.history.current.status).toBe('BUZZ_OPEN');

    fire(); // legit server timer expires the clue
    expect(server.history.current.status).toBe('CLUE_EXPIRED');

    // ...nor dismiss the lingering clue early
    p1.send('host', JSON.stringify({ type: 'DISMISS_CLUE' }));
    expect(server.history.current.status).toBe('CLUE_EXPIRED');
  });

  it('handles undo', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);

    p1.send('host', selectClueMsg);

    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_READING');

    p1.send('host', JSON.stringify({ type: 'UNDO' }));

    expect(lastStateFrom(p1Messages).state.status).toBe('CHOOSE_CLUE');
  });

  it('undo back into CLUE_READING re-arms the reading timer', () => {
    const { timer, fire, armedMs } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    MockTransport.link(host, p1);
    MockTransport.link(host, new MockTransport('player2'));

    p1.send('host', selectClueMsg);
    fire(); // reading lockout ends
    expect(server.history.current.status).toBe('BUZZ_OPEN');

    p1.send('host', JSON.stringify({ type: 'UNDO' }));
    expect(server.history.current.status).toBe('CLUE_READING');
    expect(armedMs()).toBe(5000);

    fire(); // re-armed reading timer reopens the window
    expect(server.history.current.status).toBe('BUZZ_OPEN');
  });

  it('runs the full phase cascade: reading → buzz window → expired → board', () => {
    const { timer, fire, armedMs } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);
    MockTransport.link(host, new MockTransport('player2'));

    p1.send('host', selectClueMsg);
    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_READING');
    expect(armedMs()).toBe(5000); // readingMs

    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('BUZZ_OPEN');
    expect(armedMs()).toBe(5000); // buzzerMs

    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_EXPIRED');
    expect(lastStateFrom(p1Messages).state.activeClue!.id).toBe(1);
    expect(armedMs()).toBe(5000); // dismissMs

    fire();
    const final = lastStateFrom(p1Messages).state;
    expect(final.status).toBe('CHOOSE_CLUE');
    expect(final.burnedClueIds).toContain(1);
    expect(final.currentTurnPlayerId).toBe('alice');
    expect(armedMs()).toBeNull(); // no timer on the board
    expect(server.history.current.status).toBe('CHOOSE_CLUE');
  });

  it('uses configured phase durations', () => {
    const { timer, fire, armedMs } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer, readingMs: 100, buzzerMs: 200, dismissMs: 300 });

    const p1 = new MockTransport('player1');
    MockTransport.link(host, p1);

    p1.send('host', selectClueMsg);
    expect(armedMs()).toBe(100);
    fire();
    expect(armedMs()).toBe(200);
    fire();
    expect(armedMs()).toBe(300);
  });

  it('rejects buzzes during the reading lockout', () => {
    const { timer } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);

    // Bob buzzes before the reading timer fires — rejected
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(server.history.current.status).toBe('CLUE_READING');
    expect(server.history.current.answeringPlayerId).toBeNull();
  });

  it('buzz-window timer re-arms when player fails and others can still buzz', () => {
    const { timer, fire, armedMs } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // reading lockout ends, window opens

    // Bob buzzes and gets it wrong — window reopens for alice with a fresh timer
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    p2.send('host', JSON.stringify({ type: 'JUDGE_ANSWER', correct: false }));
    expect(lastStateFrom(p1Messages).state.status).toBe('BUZZ_OPEN');
    expect(armedMs()).toBe(5000);

    // Window expires, clue lingers, then burns
    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_EXPIRED');
    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('CHOOSE_CLUE');
    expect(lastStateFrom(p1Messages).state.burnedClueIds).toContain(1);
  });

  it('buzz replaces the window-expiry timer with the answer-lock timer', () => {
    const { timer, fire, armedMs } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    // Bob buzzes — moves to ANSWER_PHASE, expiry timer replaced by answerMs
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(lastStateFrom(p1Messages).state.status).toBe('ANSWER_PHASE');
    expect(armedMs()).toBe(10000);

    // Answer time runs out: input locks, but no further timer — the
    // verdict is up to the players
    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('ANSWER_LOCKED');
    expect(armedMs()).toBeNull();

    // Judging still works after the lock
    p2.send('host', JSON.stringify({ type: 'JUDGE_ANSWER', correct: true }));
    expect(lastStateFrom(p1Messages).state.status).toBe('CHOOSE_CLUE');
    expect(lastStateFrom(p1Messages).state.players['bob']!.score).toBe(200);
  });

  it('full game flow: select, buzz, judge correct', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer });

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

    fire(); // reading lockout ends

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
