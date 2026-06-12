import type { GameState, Action } from './types.js';
import { reducer } from './reducer.js';

export interface GameHistory {
  current: GameState;
  past: GameState[];
}

export function createHistory(initialState: GameState): GameHistory {
  return { current: initialState, past: [] };
}

export interface DispatchOptions {
  /** Apply the change without pushing an undo entry. Used for high-frequency
   *  actions like answer keystrokes, so undo reverts to the last meaningful
   *  boundary (buzz, lock) instead of stepping back letter by letter. */
  transient?: boolean;
}

export function dispatch(
  history: GameHistory,
  action: Action,
  opts: DispatchOptions = {},
): GameHistory {
  const next = reducer(history.current, action);
  // If state didn't change (invalid action), don't push to history
  if (next === history.current) return history;
  if (opts.transient) {
    return { current: next, past: history.past };
  }
  return {
    current: next,
    past: [...history.past, history.current],
  };
}

export function undo(history: GameHistory): GameHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    current: previous,
    past: history.past.slice(0, -1),
  };
}

export function canUndo(history: GameHistory): boolean {
  return history.past.length > 0;
}
