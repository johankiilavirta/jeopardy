import { describe, it, expect } from 'vitest';
import { MockTransport } from '../mockTransport.js';
import { createServer, type Timer } from '../server.js';
import type { GameState } from '../types.js';

/** Multi-slot timer mock: the server keeps a window timer and one personal
 *  typing timer per buzzer pending at once. Timers are tracked in arming
 *  order; fire(i) runs and removes the i-th pending timer. */
function createMockTimer() {
  let nextId = 1;
  const pending = new Map<number, { cb: () => void; ms: number }>();
  let setCalls = 0;
  const timer: Timer = {
    set: (cb, ms) => {
      setCalls++;
      const id = nextId++;
      pending.set(id, { cb, ms });
      return id;
    },
    clear: (id) => {
      pending.delete(id as number);
    },
  };
  return {
    timer,
    /** Durations of all pending timers, in arming order. */
    pendingMs: () => [...pending.values()].map(t => t.ms),
    count: () => pending.size,
    /** Total timer.set() calls ever — detects unwanted re-arms. */
    setCalls: () => setCalls,
    fire: (index = 0) => {
      const entry = [...pending.entries()][index];
      if (!entry) throw new Error(`no pending timer at index ${index}`);
      pending.delete(entry[0]);
      entry[1].cb();
    },
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

  it('lets a client SKIP_CLUE — burns it and broadcasts to both players', () => {
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob']);

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    const p2Messages = captureMessages(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    // Right-click / P key on the board sends SKIP_CLUE with a clue id.
    p1.send('host', JSON.stringify({ type: 'SKIP_CLUE', clueId: 7 }));

    const p1State = lastStateFrom(p1Messages);
    const p2State = lastStateFrom(p2Messages);
    expect(p1State.state.status).toBe('CHOOSE_CLUE');
    expect(p1State.state.burnedClueIds).toContain(7);
    // Server-authoritative: the burn reaches the *other* player too.
    expect(p2State.state.burnedClueIds).toContain(7);
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

  it('ignores client-sent timer actions (TIMEOUT, BUZZER_OPEN, DISMISS_CLUE)', () => {
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
    const { timer, fire, pendingMs } = createMockTimer();
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
    expect(pendingMs()).toEqual([600]);

    fire(); // re-armed reading timer reopens the window
    expect(server.history.current.status).toBe('BUZZ_OPEN');
  });

  it('undo clears personal timers and rebuilds fresh', () => {
    const { timer, fire, pendingMs, count } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(pendingMs()).toEqual([8000, 10000]); // window + bob's typing timer

    // Undo the buzz: bob's personal timer must vanish, the window timer
    // restarts fresh (no timestamps in state — documented tradeoff).
    p1.send('host', JSON.stringify({ type: 'UNDO' }));
    expect(server.history.current.buzzes).toEqual([]);
    expect(pendingMs()).toEqual([8000]);
    expect(count()).toBe(1);
  });

  it('runs the full phase cascade: reading → buzz window → expired → board', () => {
    const { timer, fire, pendingMs, count } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p1Messages = captureMessages(p1);
    MockTransport.link(host, p1);
    MockTransport.link(host, new MockTransport('player2'));

    p1.send('host', selectClueMsg);
    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_READING');
    expect(pendingMs()).toEqual([600]); // readingMs

    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('BUZZ_OPEN');
    expect(pendingMs()).toEqual([8000]); // buzzerMs

    fire();
    expect(lastStateFrom(p1Messages).state.status).toBe('CLUE_EXPIRED');
    expect(lastStateFrom(p1Messages).state.activeClue!.id).toBe(1);
    expect(pendingMs()).toEqual([5000]); // dismissMs

    fire();
    const final = lastStateFrom(p1Messages).state;
    expect(final.status).toBe('CHOOSE_CLUE');
    expect(final.burnedClueIds).toContain(1);
    expect(final.currentTurnPlayerId).toBe('alice');
    expect(count()).toBe(0); // no timer on the board
    expect(server.history.current.status).toBe('CHOOSE_CLUE');
  });

  it('uses configured phase durations', () => {
    const { timer, fire, pendingMs } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer, readingMs: 100, buzzerMs: 200, dismissMs: 300 });

    const p1 = new MockTransport('player1');
    MockTransport.link(host, p1);

    p1.send('host', selectClueMsg);
    expect(pendingMs()).toEqual([100]);
    fire();
    expect(pendingMs()).toEqual([200]);
    fire();
    expect(pendingMs()).toEqual([300]);
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
    expect(server.history.current.buzzes).toEqual([]);
  });

  it('BUZZ and SET_ANSWER do not reset the window timer', () => {
    const { timer, fire, pendingMs, setCalls } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens
    const callsAfterOpen = setCalls();

    // Bob buzzes: only his personal timer is added — the window timer
    // (armed first, so still at index 0) keeps running untouched.
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(pendingMs()).toEqual([8000, 10000]);
    expect(setCalls()).toBe(callsAfterOpen + 1);

    // Typing arms nothing new either
    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'PLU' }));
    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'PLUTO' }));
    expect(setCalls()).toBe(callsAfterOpen + 1);
    expect(pendingMs()).toEqual([8000, 10000]);

    // The untouched window timer is still the one that fires TIMEOUT
    fire(0);
    expect(server.history.current.status).toBe('ANSWERING');
  });

  it('staggered buzzes get their own personal timers; locks clear them', () => {
    const { timer, fire, pendingMs, count } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(pendingMs()).toEqual([8000, 10000]); // window + bob

    // Alice buzzes too: everyone in — window timer cleared (moot), her
    // own 10s starts from her buzz, bob's keeps running untouched.
    p1.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(server.history.current.status).toBe('ANSWERING');
    expect(pendingMs()).toEqual([10000, 10000]); // bob, alice

    // Bob swipe-locks: his timer is cleared, alice's remains
    p2.send('host', JSON.stringify({ type: 'LOCK_ANSWER', answer: 'PLUTO' }));
    expect(count()).toBe(1);
    expect(server.history.current.status).toBe('ANSWERING');

    // Alice's personal timer expires: she locks with her synced text → REVEAL
    fire(0);
    expect(server.history.current.status).toBe('REVEAL');
    expect(count()).toBe(0); // REVEAL is untimed — judging is manual
  });

  it('a late buzz keeps its full typing time after the window closes', () => {
    const { timer, fire, pendingMs } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    // Bob buzzes just before the window closes
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    fire(0); // window TIMEOUT → ANSWERING
    expect(server.history.current.status).toBe('ANSWERING');

    // Bob's personal timer survives the phase change, never re-armed
    expect(pendingMs()).toEqual([10000]);

    fire(0); // his time runs out → all locked → REVEAL
    expect(server.history.current.status).toBe('REVEAL');
  });

  it('timer-fired lock keeps the last synced text', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'HALF TY' }));
    fire(1); // bob's personal timer fires before he locks

    const buzz = server.history.current.buzzes[0]!;
    expect(buzz).toEqual({ playerId: 'bob', answer: 'HALF TY', locked: true });
  });

  it('cannot lock or type for the opponent', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    p2.send('host', JSON.stringify({ type: 'BUZZ' }));

    // Alice (hasn't buzzed) tries to type/lock as bob — the server
    // overrides playerId to alice, and the reducer rejects a non-buzzer.
    p1.send('host', JSON.stringify({ type: 'SET_ANSWER', playerId: 'bob', text: 'HIJACK' }));
    p1.send('host', JSON.stringify({ type: 'LOCK_ANSWER', playerId: 'bob', answer: 'HIJACK' }));

    expect(server.history.current.buzzes).toEqual([
      { playerId: 'bob', answer: '', locked: false },
    ]);
  });

  it('SET_ANSWER is transient: undo skips keystrokes back to the buzz', () => {
    const { timer, fire } = createMockTimer();
    const host = new MockTransport('host');
    const server = createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    p1.send('host', selectClueMsg);
    fire(); // window opens

    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'P' }));
    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'PLUTO' }));

    p1.send('host', JSON.stringify({ type: 'UNDO' }));
    // One undo reverts the buzz (and all typing with it), not one letter
    expect(server.history.current.buzzes).toEqual([]);
    expect(server.history.current.status).toBe('BUZZ_OPEN');
  });

  it('full happy path: both buzz, both answer, judging walks buzz order', () => {
    const { timer, fire, count } = createMockTimer();
    const host = new MockTransport('host');
    createServer(host, ['Alice', 'Bob'], { timer });

    const p1 = new MockTransport('player1');
    const p2 = new MockTransport('player2');
    const p1Messages = captureMessages(p1);
    const p2Messages = captureMessages(p2);
    MockTransport.link(host, p1);
    MockTransport.link(host, p2);

    // Alice selects a $400 clue
    p1.send('host', JSON.stringify({
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'Science', text: 'Q', answer: 'A', value: 400 },
    }));

    fire(); // reading lockout ends

    // Bob buzzes first, alice second — both type simultaneously
    p2.send('host', JSON.stringify({ type: 'BUZZ' }));
    p1.send('host', JSON.stringify({ type: 'BUZZ' }));
    expect(lastStateFrom(p2Messages).state.status).toBe('ANSWERING');

    p2.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'WRONG GUESS' }));
    p1.send('host', JSON.stringify({ type: 'SET_ANSWER', text: 'RIGHT ANSW' }));

    // Both swipe-lock; the last lock reveals
    p2.send('host', JSON.stringify({ type: 'LOCK_ANSWER', answer: 'WRONG GUESS' }));
    p1.send('host', JSON.stringify({ type: 'LOCK_ANSWER', answer: 'RIGHT ANSWER' }));

    const reveal = lastStateFrom(p1Messages).state;
    expect(reveal.status).toBe('REVEAL');
    expect(reveal.buzzes).toEqual([
      { playerId: 'bob', answer: 'WRONG GUESS', locked: true },
      { playerId: 'alice', answer: 'RIGHT ANSWER', locked: true },
    ]);
    expect(count()).toBe(0); // no timers during the reveal

    // Bob (first buzzer) is judged wrong: −400, alice's answer goes up
    p2.send('host', JSON.stringify({ type: 'JUDGE_ANSWER', playerId: 'bob', correct: false }));
    let state = lastStateFrom(p1Messages).state;
    expect(state.status).toBe('REVEAL');
    expect(state.players['bob']!.score).toBe(-400);

    // Alice is judged correct: +400, she picks next
    p1.send('host', JSON.stringify({ type: 'JUDGE_ANSWER', playerId: 'alice', correct: true }));
    state = lastStateFrom(p1Messages).state;
    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.players['alice']!.score).toBe(400);
    expect(state.currentTurnPlayerId).toBe('alice');
    expect(state.burnedClueIds).toContain(1);
    expect(count()).toBe(0);
  });
});
