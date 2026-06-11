import { describe, it, expect } from 'vitest';
import { createInitialState, reducer } from '../reducer.js';
import type { GameState } from '../types.js';

const clue = (id: number, value = 200) => ({
  id,
  category: 'Science',
  text: 'This is the question',
  answer: 'What is the answer',
  value,
});

/** Select a clue and open the buzz window (the common path to a buzzable state) */
function openClue(state: GameState, playerId: string, id = 1, value = 200): GameState {
  state = reducer(state, { type: 'SELECT_CLUE', playerId, clue: clue(id, value) });
  return reducer(state, { type: 'BUZZER_OPEN' });
}

describe('createInitialState', () => {
  it('creates state with players and CHOOSE_CLUE status', () => {
    const state = createInitialState(['Alice', 'Bob']);
    expect(state.status).toBe('CHOOSE_CLUE');
    expect(Object.keys(state.players)).toHaveLength(2);
    expect(state.players['alice']!.name).toBe('Alice');
    expect(state.players['bob']!.name).toBe('Bob');
    expect(state.currentTurnPlayerId).toBeNull();
  });
});

describe('SELECT_CLUE', () => {
  it('anyone can pick the first clue', () => {
    const state = createInitialState(['Alice', 'Bob']);
    const next = reducer(state, { type: 'SELECT_CLUE', playerId: 'bob', clue: clue(1) });
    expect(next.status).toBe('CLUE_READING');
    expect(next.activeClue!.id).toBe(1);
    expect(next.clueSelectPlayerId).toBe('bob');
  });

  it('only the designated player can pick when turn is set', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, currentTurnPlayerId: 'alice' };
    const next = reducer(state, { type: 'SELECT_CLUE', playerId: 'bob', clue: clue(1) });
    expect(next.status).toBe('CHOOSE_CLUE'); // no change
  });

  it('cannot pick a burned clue', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, burnedClueIds: [1] };
    const next = reducer(state, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    expect(next.status).toBe('CHOOSE_CLUE'); // no change
  });
});

describe('BUZZER_OPEN', () => {
  it('opens the buzz window during CLUE_READING', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = reducer(state, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    const next = reducer(state, { type: 'BUZZER_OPEN' });
    expect(next.status).toBe('BUZZ_OPEN');
    expect(next.activeClue!.id).toBe(1);
  });

  it('is rejected outside CLUE_READING', () => {
    const state = createInitialState(['Alice', 'Bob']);
    expect(reducer(state, { type: 'BUZZER_OPEN' })).toBe(state);

    const open = openClue(state, 'alice');
    expect(reducer(open, { type: 'BUZZER_OPEN' })).toBe(open);
  });
});

describe('BUZZ', () => {
  it('is rejected during CLUE_READING (reading lockout)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = reducer(state, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next).toBe(state); // reference equality — no change
  });

  it('first buzz wins during BUZZ_OPEN', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next.status).toBe('ANSWER_PHASE');
    expect(next.answeringPlayerId).toBe('bob');
  });

  it('cannot buzz if already failed this clue', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    // Bob already failed, can't buzz again
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next.status).toBe('BUZZ_OPEN'); // unchanged
    expect(next.answeringPlayerId).toBeNull();
  });

  it('cannot buzz during CHOOSE_CLUE', () => {
    const state = createInitialState(['Alice', 'Bob']);
    const next = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    expect(next).toBe(state); // reference equality — no change
  });

  it('cannot buzz during CLUE_EXPIRED', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'TIMEOUT' });
    expect(state.status).toBe('CLUE_EXPIRED');
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next).toBe(state);
  });
});

describe('JUDGE_ANSWER', () => {
  it('correct answer: awards points, burns clue, winner picks next', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice', 1, 400);
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.players['bob']!.score).toBe(400);
    expect(state.currentTurnPlayerId).toBe('bob');
    expect(state.burnedClueIds).toContain(1);
    expect(state.activeClue).toBeNull();
  });

  it('incorrect answer: deducts points, buzz window reopens for others', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice', 1, 200);
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });

    expect(state.status).toBe('BUZZ_OPEN');
    expect(state.players['bob']!.score).toBe(-200);
    expect(state.activeClue!.failedPlayerIds).toContain('bob');
    expect(state.answeringPlayerId).toBeNull();
  });

  it('all players fail: burns clue, original picker keeps turn', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice', 1, 200);
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: false });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.currentTurnPlayerId).toBe('alice'); // original picker
    expect(state.burnedClueIds).toContain(1);
  });

  it('only the answering player can judge', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    const next = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });
    expect(next).toBe(state); // no change — alice isn't answering
  });
});

describe('TIMEOUT', () => {
  it('expires the clue but keeps it on screen — nothing burned yet', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'TIMEOUT' });

    expect(state.status).toBe('CLUE_EXPIRED');
    expect(state.activeClue!.id).toBe(1);
    expect(state.burnedClueIds).not.toContain(1);
    expect(state.currentTurnPlayerId).toBeNull(); // no turn change yet
  });

  it('works after one player fails and the reopened window expires', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    // Now only alice can buzz, but the window expires
    state = reducer(state, { type: 'TIMEOUT' });

    expect(state.status).toBe('CLUE_EXPIRED');
    expect(state.activeClue!.id).toBe(1);
  });

  it('is rejected outside BUZZ_OPEN', () => {
    const idle = createInitialState(['Alice', 'Bob']);
    expect(reducer(idle, { type: 'TIMEOUT' })).toBe(idle);

    // During reading lockout
    const reading = reducer(idle, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    expect(reducer(reading, { type: 'TIMEOUT' })).toBe(reading);

    // Already expired
    const expired = reducer(openClue(idle, 'alice'), { type: 'TIMEOUT' });
    expect(reducer(expired, { type: 'TIMEOUT' })).toBe(expired);
  });
});

describe('DISMISS_CLUE', () => {
  it('burns the expired clue, returns to board, original picker keeps turn', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'TIMEOUT' });
    state = reducer(state, { type: 'DISMISS_CLUE' });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.currentTurnPlayerId).toBe('alice');
    expect(state.burnedClueIds).toContain(1);
    expect(state.activeClue).toBeNull();
  });

  it('is rejected outside CLUE_EXPIRED', () => {
    const idle = createInitialState(['Alice', 'Bob']);
    expect(reducer(idle, { type: 'DISMISS_CLUE' })).toBe(idle);

    const open = openClue(idle, 'alice');
    expect(reducer(open, { type: 'DISMISS_CLUE' })).toBe(open);
  });
});

describe('GAME_OVER', () => {
  it('triggers when last clue is burned', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, burnedClueIds: Array.from({ length: 29 }, (_, i) => i + 1), totalClues: 30 };

    state = openClue(state, 'alice', 30, 200);
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });

    expect(state.status).toBe('GAME_OVER');
    expect(state.burnedClueIds).toHaveLength(30);
  });

  it('triggers when last clue expires and is dismissed', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, burnedClueIds: Array.from({ length: 29 }, (_, i) => i + 1), totalClues: 30 };

    state = openClue(state, 'alice', 30);
    state = reducer(state, { type: 'TIMEOUT' });
    expect(state.status).toBe('CLUE_EXPIRED'); // linger first, even on the last clue
    state = reducer(state, { type: 'DISMISS_CLUE' });

    expect(state.status).toBe('GAME_OVER');
    expect(state.burnedClueIds).toHaveLength(30);
  });
});
