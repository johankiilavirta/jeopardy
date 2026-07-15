import { describe, it, expect } from 'vitest';
import { createInitialState } from '../reducer.js';
import { createHistory, dispatch, undo, redo, canUndo, canRedo } from '../history.js';

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
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    h = dispatch(h, { type: 'BUZZ', playerId: 'bob' });
    h = dispatch(h, { type: 'TIMEOUT' });
    h = dispatch(h, { type: 'LOCK_ANSWER', playerId: 'bob', answer: 'X' });
    h = dispatch(h, { type: 'JUDGE_ANSWER', playerId: 'bob', correct: true });

    expect(h.current.players['bob']!.score).toBe(200);
    h = undo(h);
    expect(h.current.status).toBe('REVEAL');
    h = undo(h);
    expect(h.current.status).toBe('ANSWERING');
    h = undo(h);
    expect(h.current.status).toBe('BUZZ_OPEN');
    expect(h.current.buzzes).toHaveLength(1);
    h = undo(h);
    expect(h.current.status).toBe('BUZZ_OPEN');
    expect(h.current.buzzes).toHaveLength(0);
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

  it('transient dispatch applies the change without growing past', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) }, { transient: true });
    expect(h.current.status).toBe('CLUE_READING');
    expect(canUndo(h)).toBe(false);
  });

  it('undo after transient typing reverts to the buzz boundary, not per-keystroke', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    h = dispatch(h, { type: 'BUZZ', playerId: 'bob' });
    h = dispatch(h, { type: 'SET_ANSWER', playerId: 'bob', text: 'P' }, { transient: true });
    h = dispatch(h, { type: 'SET_ANSWER', playerId: 'bob', text: 'PL' }, { transient: true });
    h = dispatch(h, { type: 'SET_ANSWER', playerId: 'bob', text: 'PLUTO' }, { transient: true });

    expect(h.current.buzzes[0]!.answer).toBe('PLUTO');
    h = undo(h);
    // One undo skips all the keystrokes: back to the pre-buzz window
    expect(h.current.status).toBe('BUZZ_OPEN');
    expect(h.current.buzzes).toHaveLength(0);
  });

  it('transient dispatch of an invalid action is a no-op', () => {
    const h = createHistory(createInitialState(['Alice', 'Bob']));
    const next = dispatch(h, { type: 'BUZZ', playerId: 'alice' }, { transient: true });
    expect(next).toBe(h);
  });

  it('starts with no redo available', () => {
    const h = createHistory(createInitialState(['Alice', 'Bob']));
    expect(canRedo(h)).toBe(false);
  });

  it('redo restores an undone state', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    const afterSelect = h.current;
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.current).toEqual(afterSelect);
    expect(canRedo(h)).toBe(false);
  });

  it('multiple undo then redo walk forward again', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    h = dispatch(h, { type: 'BUZZ', playerId: 'bob' });

    h = undo(h);
    h = undo(h);
    expect(h.current.status).toBe('CLUE_READING');
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(h.current.status).toBe('BUZZ_OPEN');
    expect(h.current.buzzes).toHaveLength(0);
    h = redo(h);
    expect(h.current.buzzes).toHaveLength(1);
    expect(canRedo(h)).toBe(false);
  });

  it('new dispatch clears the future stack', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    // Branch: dispatch a new action instead of redoing
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    expect(canRedo(h)).toBe(false);
  });

  it('redo at the end of history is a no-op', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    const before = h;
    const after = redo(before);
    expect(after).toBe(before);
  });

  it('transient dispatch preserves the future stack', () => {
    let h = createHistory(createInitialState(['Alice', 'Bob']));
    h = dispatch(h, { type: 'SELECT_CLUE', playerId: 'alice', clue: clue(1) });
    h = dispatch(h, { type: 'BUZZER_OPEN' });
    h = dispatch(h, { type: 'BUZZ', playerId: 'bob' });
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    // Transient dispatch should not clear future
    h = dispatch(h, { type: 'SET_ANSWER', playerId: 'bob', text: 'X' }, { transient: true });
    expect(canRedo(h)).toBe(true);
  });
});
