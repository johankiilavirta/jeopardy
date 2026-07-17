import { describe, expect, it } from 'vitest';
import { buildServerOptions, countClues, TOTAL_CLUES_DEMO, validateResumeState, type SetupGameData } from '../gameSetup.js';
import { createInitialState } from '../reducer.js';
import type { GameState } from '../types.js';

function cat(name: string, clueCount: number) {
  return {
    name,
    clues: Array.from({ length: clueCount }, (_, r) => ({ value: (r + 1) * 200, text: `${name} Q${r}`, answer: `A${r}` })),
  };
}

function fullGame(): SetupGameData {
  return {
    round1: [cat('R1A', 5), cat('R1B', 5), cat('R1C', 4)],
    round2: [cat('R2A', 5), cat('R2B', 3)],
    final: { category: 'FJ', text: 'Q', answer: 'A' },
  };
}

describe('countClues', () => {
  it('sums actual clues, handling incomplete categories', () => {
    expect(countClues(fullGame().round1)).toBe(14);
    expect(countClues([])).toBe(0);
  });
});

describe('buildServerOptions', () => {
  it('falls back to the demo board when no game data', () => {
    const opts = buildServerOptions(null, null);
    expect(opts).toEqual({ totalClues: TOTAL_CLUES_DEMO, finalClue: null });
    expect(opts.initialState).toBeUndefined();
  });

  it('counts both rounds and arms Final Jeopardy for a full game', () => {
    const opts = buildServerOptions(fullGame(), null);
    expect(opts.totalClues).toBe(22);
    expect(opts.finalClue).toEqual({ category: 'FJ', text: 'Q', answer: 'A' });
    expect(opts.initialState).toBeUndefined();
  });

  it('resume: takes totalClues from the saved state and seeds initialState', () => {
    const saved: GameState = { ...createInitialState(['Alice', 'Bob'], 22), burnedClueIds: [0, 1] };
    const opts = buildServerOptions(fullGame(), saved);
    expect(opts.totalClues).toBe(22);
    expect(opts.initialState).toBe(saved);
    expect(opts.finalClue).toEqual({ category: 'FJ', text: 'Q', answer: 'A' });
  });
});

describe('validateResumeState', () => {
  it('rejects garbage payloads', () => {
    expect(validateResumeState(null)).toBeNull();
    expect(validateResumeState('not a state')).toBeNull();
    expect(validateResumeState({})).toBeNull();
    expect(validateResumeState({ players: { alice: {} } })).toBeNull(); // no burnedClueIds
    expect(validateResumeState({ burnedClueIds: [] })).toBeNull(); // no players
  });

  it('normalizes an in-flight clue back to the board', () => {
    const state: GameState = {
      ...createInitialState(['Alice', 'Bob'], 25),
      status: 'ANSWERING',
      activeClue: { id: 7, category: 'C', text: 'Q', answer: 'A', value: 200, failedPlayerIds: [] },
      buzzes: [{ playerId: 'alice', answer: 'wip', locked: false }],
      burnedClueIds: [0, 1],
    };
    const resumed = validateResumeState(state);
    expect(resumed?.status).toBe('CHOOSE_CLUE');
    expect(resumed?.activeClue).toBeNull();
    expect(resumed?.buzzes).toEqual([]);
    expect(resumed?.burnedClueIds).toEqual([0, 1]);
  });

  it('passes a board-phase state through untouched', () => {
    const state = createInitialState(['Alice'], 30);
    expect(validateResumeState(state)).toBe(state);
  });
});
