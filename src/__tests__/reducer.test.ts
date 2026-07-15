import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  reducer,
  getBuzz,
  allBuzzersLocked,
  judgedPlayerId,
} from '../reducer.js';
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

/** Both players buzz (bob first), type, and lock — lands in REVEAL. */
function bothAnswered(state: GameState, id = 1, value = 200): GameState {
  state = openClue(state, 'alice', id, value);
  state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
  state = reducer(state, { type: 'BUZZ', playerId: 'alice' }); // → ANSWERING
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'BOBS ANSWER' });
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: 'ALICES ANSWER' });
  state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
  return reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' }); // → REVEAL
}

describe('createInitialState', () => {
  it('creates state with players and CHOOSE_CLUE status', () => {
    const state = createInitialState(['Alice', 'Bob']);
    expect(state.status).toBe('CHOOSE_CLUE');
    expect(Object.keys(state.players)).toHaveLength(2);
    expect(state.players['alice']!.name).toBe('Alice');
    expect(state.players['bob']!.name).toBe('Bob');
    expect(state.currentTurnPlayerId).toBeNull();
    expect(state.buzzes).toEqual([]);
  });

  it('initializes per-player stats fields', () => {
    const state = createInitialState(['Alice', 'Bob']);
    for (const p of Object.values(state.players)) {
      expect(p.correct).toBe(0);
      expect(p.incorrect).toBe(0);
      expect(p.scoreHistory).toEqual([0]);
    }
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

  it('resets buzzes from any stale state', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = {
      ...state,
      buzzes: [{ playerId: 'bob', answer: 'LEFTOVER', locked: true }],
    };
    const next = reducer(state, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    expect(next.buzzes).toEqual([]);
  });
});

describe('SKIP_CLUE', () => {
  it('burns a clue from the board, staying in CHOOSE_CLUE', () => {
    const state = createInitialState(['Alice', 'Bob']);
    const next = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 7 });
    expect(next.status).toBe('CHOOSE_CLUE');
    expect(next.burnedClueIds).toContain(7);
  });

  it('skips regardless of whose turn it is (testing tool, no turn check)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, currentTurnPlayerId: 'alice' };
    const next = reducer(state, { type: 'SKIP_CLUE', playerId: 'bob', clueId: 3 });
    expect(next.burnedClueIds).toContain(3);
    expect(next.currentTurnPlayerId).toBe('alice'); // board skip leaves turn untouched
  });

  it('skips the active clue when one is up, returning the turn to its picker', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = reducer(state, { type: 'SELECT_CLUE', playerId: 'bob', clue: clue(4) });
    expect(state.status).toBe('CLUE_READING');
    // clueId in the action is ignored — the active clue (4) is what gets burned.
    const next = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 999 });
    expect(next.status).toBe('CHOOSE_CLUE');
    expect(next.activeClue).toBeNull();
    expect(next.burnedClueIds).toContain(4);
    expect(next.currentTurnPlayerId).toBe('bob');
  });

  it('is a no-op on an already-burned clue', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, burnedClueIds: [2] };
    const next = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 2 });
    expect(next).toBe(state); // unchanged reference
  });

  it('ends the game when the last clue is skipped', () => {
    let state = createInitialState(['Alice', 'Bob'], 3);
    state = { ...state, burnedClueIds: [0, 1] };
    const next = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 2 });
    expect(next.status).toBe('GAME_OVER');
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

  it('first buzz appends an empty entry without closing the window', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next.status).toBe('BUZZ_OPEN'); // alice can still buzz
    expect(next.buzzes).toEqual([{ playerId: 'bob', answer: '', locked: false }]);
  });

  it('records buzz order, and the last possible buzz closes the window', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    expect(state.status).toBe('ANSWERING'); // everyone buzzed — window moot
    expect(state.buzzes.map(b => b.playerId)).toEqual(['bob', 'alice']);
  });

  it('duplicate buzz is a no-op', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    const next = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(next).toBe(state);
  });

  it('unknown player cannot buzz', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    const next = reducer(state, { type: 'BUZZ', playerId: 'mallory' });
    expect(next).toBe(state);
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

  it('cannot buzz once ANSWERING (window closed)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'TIMEOUT' }); // window expires while bob types
    expect(state.status).toBe('ANSWERING');
    const next = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    expect(next).toBe(state);
  });
});

describe('SET_ANSWER', () => {
  it('updates the typing player\'s answer during BUZZ_OPEN', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'PLUTO' });
    expect(getBuzz(state, 'bob')!.answer).toBe('PLUTO');
    expect(state.status).toBe('BUZZ_OPEN'); // no status change
  });

  it('updates during ANSWERING too', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'TIMEOUT' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'MARS' });
    expect(getBuzz(state, 'bob')!.answer).toBe('MARS');
  });

  it('is rejected for a player who has not buzzed', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    const next = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: 'SNEAKY' });
    expect(next).toBe(state);
  });

  it('is rejected once that player is locked', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'FINAL' });
    const next = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'CHANGED' });
    expect(next).toBe(state);
  });

  it('is rejected outside BUZZ_OPEN/ANSWERING', () => {
    const idle = createInitialState(['Alice', 'Bob']);
    expect(reducer(idle, { type: 'SET_ANSWER', playerId: 'alice', text: 'X' })).toBe(idle);

    const reading = reducer(idle, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    expect(reducer(reading, { type: 'SET_ANSWER', playerId: 'alice', text: 'X' })).toBe(reading);

    const reveal = bothAnswered(idle);
    expect(reveal.status).toBe('REVEAL');
    expect(reducer(reveal, { type: 'SET_ANSWER', playerId: 'bob', text: 'X' })).toBe(reveal);
  });
});

describe('LOCK_ANSWER', () => {
  it('swipe-lock overwrites the answer with the final text', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'DRAF' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'DRAFT DONE' });
    expect(getBuzz(state, 'bob')).toEqual({ playerId: 'bob', answer: 'DRAFT DONE', locked: true });
  });

  it('timer-lock (no answer field) keeps the last synced text', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'PARTIAL' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(getBuzz(state, 'bob')).toEqual({ playerId: 'bob', answer: 'PARTIAL', locked: true });
  });

  it('locking during BUZZ_OPEN never reveals — others may still buzz', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(state.status).toBe('BUZZ_OPEN');
    expect(allBuzzersLocked(state)).toBe(true);
  });

  it('the last lock during ANSWERING reveals early', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' }); // → ANSWERING
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(state.status).toBe('ANSWERING'); // alice still typing
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    expect(state.status).toBe('REVEAL');
  });

  it('locking in solo mode reveals immediately even if in BUZZ_OPEN', () => {
    let state = createInitialState(['Alice']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    expect(state.status).toBe('REVEAL');
  });

  it('locking in solo mode ignores the mock opponent player', () => {
    let state = createInitialState(['Alice', 'opponent']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    expect(state.status).toBe('REVEAL');
  });

  it('is rejected for non-buzzers and already-locked players', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' })).toBe(state);

    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' })).toBe(state);
  });

  it('is rejected outside BUZZ_OPEN/ANSWERING', () => {
    const idle = createInitialState(['Alice', 'Bob']);
    expect(reducer(idle, { type: 'LOCK_ANSWER', playerId: 'alice' })).toBe(idle);

    const reveal = bothAnswered(idle);
    expect(reducer(reveal, { type: 'LOCK_ANSWER', playerId: 'bob' })).toBe(reveal);
  });
});

describe('TIMEOUT', () => {
  it('nobody buzzed: expires the clue but keeps it on screen — nothing burned yet', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'TIMEOUT' });

    expect(state.status).toBe('CLUE_EXPIRED');
    expect(state.activeClue!.id).toBe(1);
    expect(state.burnedClueIds).not.toContain(1);
    expect(state.currentTurnPlayerId).toBeNull(); // no turn change yet
  });

  it('someone still typing: closes the window into ANSWERING', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'TIMEOUT' });
    expect(state.status).toBe('ANSWERING');
  });

  it('all buzzers already locked: reveals immediately', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'DONE' });
    state = reducer(state, { type: 'TIMEOUT' });
    expect(state.status).toBe('REVEAL');
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

    // While answering
    let answering = openClue(idle, 'alice');
    answering = reducer(answering, { type: 'BUZZ', playerId: 'bob' });
    answering = reducer(answering, { type: 'TIMEOUT' });
    expect(reducer(answering, { type: 'TIMEOUT' })).toBe(answering);
  });
});

describe('judgedPlayerId', () => {
  it('is null outside REVEAL', () => {
    let state = createInitialState(['Alice', 'Bob']);
    expect(judgedPlayerId(state)).toBeNull();
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    expect(judgedPlayerId(state)).toBeNull();
  });

  it('walks buzz order, not player order', () => {
    // Bob buzzed before alice, so bob is judged first even though alice
    // comes first in the players record.
    const state = bothAnswered(createInitialState(['Alice', 'Bob']));
    expect(judgedPlayerId(state)).toBe('bob');
    const next = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    expect(judgedPlayerId(next)).toBe('alice');
  });
});

describe('JUDGE_ANSWER', () => {
  it('correct answer: awards points, burns clue, winner picks next', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 400);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.players['bob']!.score).toBe(400);
    expect(state.currentTurnPlayerId).toBe('bob');
    expect(state.burnedClueIds).toContain(1);
    expect(state.activeClue).toBeNull();
    expect(state.buzzes).toEqual([]);
  });

  it('first buzzer wrong: deducts their points, next buzzer goes on the stand', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });

    expect(state.status).toBe('REVEAL'); // alice's answer is up next
    expect(state.players['bob']!.score).toBe(-200);
    expect(state.activeClue!.failedPlayerIds).toContain('bob');
    expect(judgedPlayerId(state)).toBe('alice');
  });

  it('incorrect with penalty=false (pass): does not deduct points, next buzzer goes on the stand', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false, penalty: false });

    expect(state.status).toBe('REVEAL'); // alice's answer is up next
    expect(state.players['bob']!.score).toBe(0); // unchanged score
    expect(state.activeClue!.failedPlayerIds).toContain('bob');
    expect(judgedPlayerId(state)).toBe('alice');
  });

  it('second buzzer also risks points: wrong after wrong deducts again', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: false });

    expect(state.players['bob']!.score).toBe(-200);
    expect(state.players['alice']!.score).toBe(-200);
  });

  it('second buzzer correct after first wrong: awarded, winner picks', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.players['alice']!.score).toBe(200);
    expect(state.currentTurnPlayerId).toBe('alice');
    expect(state.burnedClueIds).toContain(1);
  });

  it('all buzzers wrong: burns clue, original picker keeps turn', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200); // alice picked
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: false });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.currentTurnPlayerId).toBe('alice'); // original picker
    expect(state.burnedClueIds).toContain(1);
    expect(state.buzzes).toEqual([]);
  });

  it('single buzzer wrong: burns clue, original picker keeps turn', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice', 1, 200);
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'NOPE' });
    state = reducer(state, { type: 'TIMEOUT' }); // → REVEAL
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });

    expect(state.status).toBe('CHOOSE_CLUE');
    expect(state.players['bob']!.score).toBe(-200);
    expect(state.currentTurnPlayerId).toBe('alice');
    expect(state.burnedClueIds).toContain(1);
  });

  it('only the judged player can be judged', () => {
    const state = bothAnswered(createInitialState(['Alice', 'Bob']));
    // Bob buzzed first — alice isn't on the stand yet
    const next = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });
    expect(next).toBe(state);
  });

  it('is rejected outside REVEAL', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    const next = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });
    expect(next).toBe(state); // still typing — no judging before the reveal
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

    state = bothAnswered(state, 30, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(state.status).toBe('GAME_OVER');
    expect(state.burnedClueIds).toHaveLength(30);
  });

  it('triggers when everyone is wrong on the last clue', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = { ...state, burnedClueIds: Array.from({ length: 29 }, (_, i) => i + 1), totalClues: 30 };

    state = bothAnswered(state, 30, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: false });

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

describe('per-player stats', () => {
  it('increments correct count and pushes scoreHistory on correct answer', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 400);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(state.players['bob']!.correct).toBe(1);
    expect(state.players['bob']!.incorrect).toBe(0);
    expect(state.players['bob']!.scoreHistory).toEqual([0, 400]);
    // Other player gets a flat history point
    expect(state.players['alice']!.scoreHistory).toEqual([0, 0]);
    expect(state.players['alice']!.correct).toBe(0);
  });

  it('increments incorrect count on wrong answer when clue burns', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: false });

    expect(state.players['bob']!.incorrect).toBe(1);
    expect(state.players['alice']!.incorrect).toBe(1);
    expect(state.players['bob']!.scoreHistory).toEqual([0, -200]);
    expect(state.players['alice']!.scoreHistory).toEqual([0, -200]);
  });

  it('increments incorrect for first wrong buzzer without history point (clue not burned)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });

    // Bob is incorrect but clue is still live — no scoreHistory push yet
    expect(state.players['bob']!.incorrect).toBe(1);
    expect(state.players['bob']!.scoreHistory).toEqual([0]); // unchanged
    expect(state.players['alice']!.scoreHistory).toEqual([0]); // unchanged
    expect(state.status).toBe('REVEAL'); // alice on the stand
  });

  it('correct after wrong: both get stats and history updated on burn', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });

    expect(state.players['bob']!.incorrect).toBe(1);
    expect(state.players['bob']!.score).toBe(-200);
    expect(state.players['alice']!.correct).toBe(1);
    expect(state.players['alice']!.score).toBe(200);
    // scoreHistory: bob got no point on his wrong (clue still live), alice's correct burns it
    expect(state.players['alice']!.scoreHistory).toEqual([0, 200]);
    expect(state.players['bob']!.scoreHistory).toEqual([0, -200]);
  });

  it('pushes flat scoreHistory on DISMISS_CLUE (nobody buzzed)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = openClue(state, 'alice');
    state = reducer(state, { type: 'TIMEOUT' });
    state = reducer(state, { type: 'DISMISS_CLUE' });

    expect(state.players['alice']!.scoreHistory).toEqual([0, 0]);
    expect(state.players['bob']!.scoreHistory).toEqual([0, 0]);
    expect(state.players['alice']!.correct).toBe(0);
    expect(state.players['alice']!.incorrect).toBe(0);
  });

  it('does NOT push scoreHistory on SKIP_CLUE (board skip)', () => {
    let state = createInitialState(['Alice', 'Bob']);
    state = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 7 });

    expect(state.players['alice']!.scoreHistory).toEqual([0]);
    expect(state.players['bob']!.scoreHistory).toEqual([0]);
  });

  it('accumulates stats across multiple clues', () => {
    let state = createInitialState(['Alice', 'Bob']);

    // Clue 1: bob correct (alice picks since no turn set yet)
    state = bothAnswered(state, 1, 200);
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });
    expect(state.currentTurnPlayerId).toBe('bob');

    // Clue 2: bob wrong, alice correct (bob picks since he won clue 1)
    state = openClue(state, 'bob', 2, 400);
    state = reducer(state, { type: 'BUZZ', playerId: 'bob' });
    state = reducer(state, { type: 'BUZZ', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });

    expect(state.players['bob']!.correct).toBe(1);
    expect(state.players['bob']!.incorrect).toBe(1);
    expect(state.players['alice']!.correct).toBe(1);
    expect(state.players['alice']!.incorrect).toBe(0);

    expect(state.players['bob']!.scoreHistory).toEqual([0, 200, -200]);
    expect(state.players['alice']!.scoreHistory).toEqual([0, 0, 400]);
  });
});
