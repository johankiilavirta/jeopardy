import { describe, expect, it } from 'vitest';
import { hasCompleteCategories, nextCompleteGameNumber } from '../../data/gameSelection.js';
import type { GameInfo } from '../../data/gameLoader.js';

function info(...clueCounts: number[]): GameInfo {
  return {
    airDate: '',
    season: null,
    round1: clueCounts.map((clueCount, i) => ({ name: `R1 ${i}`, clueCount })),
    round2: [],
  };
}

describe('game selection', () => {
  it('rejects a game with an incomplete category', () => {
    expect(hasCompleteCategories(info(5, 4))).toBe(false);
    expect(hasCompleteCategories(info(5, 5))).toBe(true);
  });

  it('skips incomplete games in the swipe direction', () => {
    const games = new Map([
      [1, info(5)],
      [2, info(4)],
      [3, info(5)],
      [4, info(3)],
      [5, info(5)],
    ]);
    const getInfo = (gameNumber: number) => games.get(gameNumber) ?? null;

    expect(nextCompleteGameNumber(1, 1, 1, 5, getInfo)).toBe(3);
    expect(nextCompleteGameNumber(1, 1, 2, 5, getInfo)).toBe(5);
    expect(nextCompleteGameNumber(5, -1, 1, 5, getInfo)).toBe(3);
  });

  it('clamps at the archive edge', () => {
    expect(nextCompleteGameNumber(1, -1, 4, 5, () => info(5))).toBe(1);
    expect(nextCompleteGameNumber(5, 1, 4, 5, () => info(5))).toBe(5);
  });
});
