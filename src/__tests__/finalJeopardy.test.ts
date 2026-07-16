import { describe, it, expect } from 'vitest';
import { createInitialState, reducer } from '../reducer.js';
import type { GameState } from '../types.js';

const finalClue = {
  category: 'WORLD CAPITALS',
  text: 'Australia moved its capital to this purpose-built city in 1927',
  answer: 'What is Canberra',
};

/** Burn every clue on a tiny board so the game falls into Final Jeopardy.
 *  Scores are seeded (alice 1500, bob 700) so the wagers below are legal —
 *  wagers clamp down to what the player actually has. */
function reachWager(scores: { alice: number; bob: number } = { alice: 1500, bob: 700 }): GameState {
  let state = createInitialState(['Alice', 'Bob'], 2, finalClue);
  state = {
    ...state,
    players: {
      ...state.players,
      alice: { ...state.players['alice']!, score: scores.alice },
      bob: { ...state.players['bob']!, score: scores.bob },
    },
  };
  state = reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 1 });
  return reducer(state, { type: 'SKIP_CLUE', playerId: 'alice', clueId: 2 });
}

/** Wagers and answers all locked — lands in REVEAL with both answers up. */
function reachReveal(aliceWager = 500, bobWager = 300): GameState {
  let state = reachWager();
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: String(aliceWager) });
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: String(bobWager) });
  state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
  state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' }); // → FINAL_JEOPARDY_ANSWER
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: 'CANBERRA' });
  state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: 'SYDNEY' });
  state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
  return reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' }); // → REVEAL
}

describe('Final Jeopardy flow', () => {
  it('burning the last clue enters the wager with the sentinel clue and everyone buzzed in', () => {
    const state = reachWager();
    expect(state.status).toBe('FINAL_JEOPARDY_WAGER');
    expect(state.activeClue!.id).toBe(-1);
    expect(state.activeClue!.text).toBe(finalClue.category);
    expect(state.buzzes.map(b => b.playerId).sort()).toEqual(['alice', 'bob']);
  });

  it('locking every wager reveals the clue text and resets the answer buzzes', () => {
    let state = reachWager();
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: '500' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: '300' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(state.status).toBe('FINAL_JEOPARDY_ANSWER');
    expect(state.activeClue!.text).toBe(finalClue.text);
    expect(state.finalWagers).toEqual({ alice: 500, bob: 300 });
    expect(state.buzzes.every(b => !b.locked && b.answer === '')).toBe(true);
  });

  it('locking every answer lands in REVEAL with the sentinel clue still up', () => {
    const state = reachReveal();
    expect(state.status).toBe('REVEAL');
    expect(state.activeClue!.id).toBe(-1);
    expect(state.buzzes).toHaveLength(2);
  });
});

describe('Final Jeopardy wager clamping', () => {
  it('a wager above the player\'s score is rounded down to the max they can bet', () => {
    let state = reachWager();
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'alice', text: '999999' });
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: '701' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(state.finalWagers).toEqual({ alice: 1500, bob: 700 });
  });

  it('empty wagers and wagers from a negative score clamp to zero', () => {
    let state = reachWager({ alice: 1500, bob: -200 });
    // Alice never types; bob bets money he doesn't have.
    state = reducer(state, { type: 'SET_ANSWER', playerId: 'bob', text: '300' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'alice' });
    state = reducer(state, { type: 'LOCK_ANSWER', playerId: 'bob' });
    expect(state.finalWagers).toEqual({ alice: 0, bob: 0 });
  });
});

describe('Final Jeopardy judging', () => {
  it('answers may be judged in any order', () => {
    let state = reachReveal();
    // Bob buzzed after alice in the wager order, but is judged first.
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    expect(state.status).toBe('REVEAL'); // alice still awaits a verdict
    expect(state.players['bob']!.score).toBe(400); // 700 - 300
    expect(state.players['bob']!.incorrect).toBe(1);
    expect(state.buzzes.map(b => b.playerId)).toEqual(['alice']);
  });

  it('the last verdict ends the game and settles every wager', () => {
    let state = reachReveal();
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });
    expect(state.status).toBe('GAME_OVER');
    expect(state.activeClue).toBeNull();
    expect(state.players['alice']!.score).toBe(2000); // 1500 + 500
    expect(state.players['alice']!.correct).toBe(1);
    expect(state.players['bob']!.score).toBe(400); // 700 - 300
  });

  it('pushes exactly one scoreHistory point per player, at the final verdict', () => {
    let state = reachReveal();
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'alice', correct: true });
    expect(state.players['alice']!.scoreHistory).toEqual([0]); // not yet
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    expect(state.players['alice']!.scoreHistory).toEqual([0, 2000]);
    expect(state.players['bob']!.scoreHistory).toEqual([0, 400]);
  });

  it('an incorrect verdict with no penalty leaves the score untouched', () => {
    let state = reachReveal();
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false, penalty: false });
    expect(state.players['bob']!.score).toBe(700);
    expect(state.players['bob']!.incorrect).toBe(1);
  });

  it('a player cannot be judged twice', () => {
    let state = reachReveal();
    state = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    const again = reducer(state, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: false });
    expect(again).toBe(state);
  });

  it('Final Jeopardy cannot be skipped', () => {
    const wager = reachWager();
    expect(reducer(wager, { type: 'SKIP_CLUE', playerId: 'alice', clueId: -1 })).toBe(wager);
    const reveal = reachReveal();
    expect(reducer(reveal, { type: 'SKIP_CLUE', playerId: 'alice', clueId: -1 })).toBe(reveal);
  });
});
