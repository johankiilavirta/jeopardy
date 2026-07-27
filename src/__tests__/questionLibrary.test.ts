import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
  },
}));

vi.mock('expo-file-system', () => ({
  File: class {},
  FileMode: { ReadOnly: 'r', WriteOnly: 'w' },
  Paths: { document: {} },
}));

import { compareQuestionOrder, isValidGameData } from '../../app/questionLibrary';

const validGame = {
  gameNumber: 1,
  airDate: '1984-09-10',
  round1: [{
    name: 'SCIENCE',
    clues: [{ value: 200, text: 'A clue', answer: 'A response' }],
  }],
  round2: [],
  final: { category: 'FINAL', text: 'Last clue', answer: 'Last response' },
};

describe('question library validation', () => {
  it('accepts the existing GameData JSON shape', () => {
    expect(isValidGameData(validGame)).toBe(true);
  });

  it('rejects malformed or dangerous game records', () => {
    expect(isValidGameData({ ...validGame, gameNumber: 0 })).toBe(false);
    expect(isValidGameData({ ...validGame, airDate: 'September 10, 1984' })).toBe(false);
    expect(isValidGameData({ ...validGame, round1: [] })).toBe(false);
    expect(isValidGameData({
      ...validGame,
      round1: [{ name: 'BROKEN', clues: [{ value: 200, text: '', answer: 'A' }] }],
    })).toBe(false);
  });

  it('orders season entries chronologically without depending on picker order', () => {
    const entries = [
      { airDate: '1990-01-02', gameNumber: 2, sourceName: 'season-7.json', offset: 10 },
      { airDate: '1989-12-31', gameNumber: 100, sourceName: 'season-6.json', offset: 20 },
      { airDate: '1990-01-02', gameNumber: 1, sourceName: 'season-7.json', offset: 30 },
    ];

    expect(entries.sort(compareQuestionOrder).map(entry => entry.gameNumber)).toEqual([100, 1, 2]);
  });
});
