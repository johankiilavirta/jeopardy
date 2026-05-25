import { describe, it, expect } from 'vitest';
import { createInitialState } from '../reducer.js';
import { createHistory, dispatch, undo, canUndo } from '../history.js';

const clue = (id: number, value = 200) => ({
  id,
  category: 'Science',
  text: 'Question',
  answer: 'Answer',
  value,
});

describe('history', () => {
  it('starts with no undo available', () => {
    const h = createHistory(createInitialState(['Alice', 'Bob']));
    expect(canUndo(h)).toBe(false);
  });

  it('tracks state changes', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    expect(h.current.status).toBe('CLUE_READING');
    expect(canUndo(h)).toBe(true);
  });

  it('undo reverts to previous state', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    const original = h.current;
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = undo(h);
    expect(h.current).toEqual(original);
    expect(canUndo(h)).toBe(false);
  });

  it('multiple undos work', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = dispatch(h, { type: 'BUZZ', playerId: 'bob' });
    h = dispatch(h, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(h.current.players['bob']!.score).toBe(200);
    h = undo(h);
    expect(h.current.status).toBe('ANSWER_PHASE');
    h = undo(h);
    expect(h.current.status).toBe('CLUE_READING');
    h = undo(h);
    expect(h.current.status).toBe('CHOOSE_CLUE');
  });

  it('does not push to history on invalid actions', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    // Can't buzz during CHOOSE_CLUE — invalid, state unchanged
    h = dispatch(h, { type: 'BUZZ', playerId: 'alice' });
    expect(canUndo(h)).toBe(false);
  });
});
