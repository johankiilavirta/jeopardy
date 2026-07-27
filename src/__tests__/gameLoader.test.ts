import { describe, it, expect } from 'vitest';
import { getVisibleBoard, loadGame, loadGameInfo, loadGameIndex, toBoardDefinition, makeClueGetter } from '../../data/gameLoader.js';
import type { GameData } from '../../data/gameLoader.js';
import { setImportedGameSource } from '../../data/importedGameStore.js';
import type { BoardDefinition } from '../../ui/fixtures/board.js';

/** 6 categories × 5 clues, ids laid out column-major (col*5 + row → 0..29). */
function sixCatBoard(): BoardDefinition {
  return {
    categories: Array.from({ length: 6 }, (_, col) => ({
      name: `CAT${col}`,
      clues: Array.from({ length: 5 }, (_, row) => ({ id: col * 5 + row, value: (row + 1) * 200 })),
    })),
  };
}
/** The 5 clue ids of a given column. */
const colIds = (col: number) => [0, 1, 2, 3, 4].map(r => col * 5 + r);
const names = (b: BoardDefinition) => b.categories.map(c => c.name);

describe('getVisibleBoard', () => {
  it('advances through reserve categories in single-column mode', () => {
    expect(names(getVisibleBoard(sixCatBoard(), [], 1))).toEqual(['CAT0']);
    expect(names(getVisibleBoard(sixCatBoard(), colIds(0), 1))).toEqual(['CAT1 *']);
    expect(names(getVisibleBoard(sixCatBoard(), [...colIds(0), ...colIds(1)], 1))).toEqual(['CAT2 *']);
  });

  it('shows the first 5 categories until a column clears', () => {
    expect(names(getVisibleBoard(sixCatBoard(), [], 5))).toEqual(['CAT0', 'CAT1', 'CAT2', 'CAT3', 'CAT4']);
  });

  it('backfills the 6th category into the first cleared column, marked with *', () => {
    const vb = getVisibleBoard(sixCatBoard(), colIds(2), 5); // column 2 cleared
    expect(names(vb)).toEqual(['CAT0', 'CAT1', 'CAT5 *', 'CAT3', 'CAT4']);
  });

  it('keeps the 6th anchored when a LOWER-index column clears later (no hopping)', () => {
    // Column 2 completes first, then column 0. The 6th must stay at column 2 —
    // this is the bug the old findIndex logic had (it would hop to column 0).
    const burned = [...colIds(2), ...colIds(0)];
    const vb = getVisibleBoard(sixCatBoard(), burned, 5);
    expect(vb.categories[2]?.name).toBe('CAT5 *'); // still column 2
    expect(vb.categories[0]?.name).toBe('CAT0');   // column 0 stays itself (fully burned)
  });

  it('anchors to completion order, not the order ids appear', () => {
    // Column 0 has clues burned early but completes LAST (its 5th clue burned
    // after column 3 fully clears). The 6th should anchor to column 3.
    const burned = [0, 1, 2, 3, ...colIds(3), 4];
    const vb = getVisibleBoard(sixCatBoard(), burned, 5);
    expect(vb.categories[3]?.name).toBe('CAT5 *');
    expect(vb.categories[0]?.name).toBe('CAT0');
  });

  it('leaves a 5-category board untouched (no 6th to bring in)', () => {
    const five: BoardDefinition = { categories: sixCatBoard().categories.slice(0, 5) };
    const vb = getVisibleBoard(five, colIds(0));
    expect(vb.categories).toHaveLength(5);
    expect(names(vb)).toEqual(['CAT0', 'CAT1', 'CAT2', 'CAT3', 'CAT4']);
  });
});

/** 6 categories per round, 5 clues each, distinct names per round. */
function twoRoundGame(): GameData {
  const cat = (name: string) => ({
    name,
    clues: Array.from({ length: 5 }, (_, r) => ({ value: (r + 1) * 200, text: `${name} Q${r}`, answer: `A${r}` })),
  });
  return {
    gameNumber: 1,
    airDate: '1984-09-10',
    round1: Array.from({ length: 6 }, (_, c) => cat(`R1C${c}`)),
    round2: Array.from({ length: 6 }, (_, c) => cat(`R2C${c}`)),
  };
}

describe('round-aware board + clue mapping', () => {
  it('round 1 board uses round1 categories with ids 0..29', () => {
    const b = toBoardDefinition(twoRoundGame(), 1);
    expect(b.categories[0]?.name).toBe('R1C0');
    expect(b.categories[0]?.clues[0]?.id).toBe(0);
    expect(b.categories[5]?.clues[4]?.id).toBe(29);
  });

  it('round 2 board uses round2 categories with ids 30..59 (no collision)', () => {
    const b = toBoardDefinition(twoRoundGame(), 2);
    expect(b.categories[0]?.name).toBe('R2C0');
    expect(b.categories[0]?.clues[0]?.id).toBe(30);
    expect(b.categories[5]?.clues[4]?.id).toBe(59);
  });

  it('a single clue getter resolves each id to its round', () => {
    const get = makeClueGetter(twoRoundGame());
    expect(get(0).category).toBe('R1C0');
    expect(get(29).category).toBe('R1C5');
    expect(get(30).category).toBe('R2C0');
    expect(get(59).category).toBe('R2C5');
  });
});

describe('loadGameInfo', () => {
  it('always reserves Game 0 for the complete built-in starter game', () => {
    setImportedGameSource(0, () => null);

    const game = loadGame(0);
    expect(game).toMatchObject({
      gameNumber: 0,
      airDate: 'BUILT-IN STARTER',
    });
    expect(game?.round1).toHaveLength(6);
    expect(game?.round2).toHaveLength(6);
    expect(game?.round1.map(category => category.name)).toEqual([
      'MATHEMATICIANS',
      'PHYSICS',
      'THE ENLIGHTENMENT',
      'TRAINS',
      'INTERNET SLANG',
      'GEOGRAPHY',
    ]);
    expect(game?.round2.map(category => category.name)).toEqual([
      'RUSSIAN WRITERS',
      'FOREIGN HOLIDAYS',
      'DESSERTS',
      'HISTORICAL HORSES',
      'THE SOLAR SYSTEM',
      'CANADA',
    ]);
    expect(game?.round1.every(category => category.clues.length === 5)).toBe(true);
    expect(game?.round2.every(category => category.clues.length === 5)).toBe(true);
    expect(game?.round1[0]?.clues.map(clue => clue.value)).toEqual([200, 400, 600, 800, 1000]);
    expect(game?.round2[0]?.clues.map(clue => clue.value)).toEqual([400, 800, 1200, 1600, 2000]);
    expect(game?.final).toMatchObject({
      category: 'VICTOR HUGO',
      answer: 'What is Guernsey?',
    });
    expect(loadGameInfo(0)).toMatchObject({
      airDate: 'BUILT-IN STARTER',
      season: null,
    });
    expect(loadGameIndex().totalGames).toBe(0);
  });

  it('reads an imported game preview without a relay', () => {
    const game = twoRoundGame();
    setImportedGameSource(1, number => number === 1 ? game : null);
    const info = loadGameInfo(1);
    expect(info).toMatchObject({
      season: 1,
      airDate: '1984-09-10',
    });
    expect(info?.round1.length).toBeGreaterThan(0);
    expect(info?.round2.length).toBeGreaterThan(0);
  });
});
