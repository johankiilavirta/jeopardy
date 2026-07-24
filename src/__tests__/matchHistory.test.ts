import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory AsyncStorage: the real module is native-only.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    removeItem: async (key: string) => { store.delete(key); },
  },
}));

import {
  computeWinnerNames,
  isOngoingMatch,
  loadMatchHistory,
  recordMatch,
  recordOngoingMatch,
  type MatchResult,
} from '../../app/matchHistory';

function match(id: string, overrides: Partial<MatchResult> = {}): MatchResult {
  const players = overrides.players ?? [
    { name: 'Alice', score: 1000, correct: 5, incorrect: 1 },
    { name: 'Bob', score: 400, correct: 3, incorrect: 2 },
  ];
  return {
    id,
    finishedAt: 1000,
    gameNumber: null,
    players,
    winnerNames: computeWinnerNames(players),
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

describe('computeWinnerNames', () => {
  it('picks the single top scorer', () => {
    expect(computeWinnerNames([
      { name: 'Alice', score: 1000, correct: 0, incorrect: 0 },
      { name: 'Bob', score: 400, correct: 0, incorrect: 0 },
    ])).toEqual(['Alice']);
  });

  it('returns every name sharing the top score on a tie', () => {
    expect(computeWinnerNames([
      { name: 'Alice', score: 400, correct: 0, incorrect: 0 },
      { name: 'Bob', score: 400, correct: 0, incorrect: 0 },
    ])).toEqual(['Alice', 'Bob']);
  });

  it('handles all-negative scores', () => {
    expect(computeWinnerNames([
      { name: 'Alice', score: -600, correct: 0, incorrect: 0 },
      { name: 'Bob', score: -200, correct: 0, incorrect: 0 },
    ])).toEqual(['Bob']);
  });

  it('returns [] with no players', () => {
    expect(computeWinnerNames([])).toEqual([]);
  });
});

describe('recordMatch / loadMatchHistory', () => {
  it('round-trips matches newest first', async () => {
    await recordMatch(match('a'));
    const afterB = await recordMatch(match('b'));

    expect(afterB.map(m => m.id)).toEqual(['b', 'a']);
    expect(await loadMatchHistory()).toEqual(afterB);
  });

  it('upserts by id: re-finishing after an undo replaces the entry', async () => {
    await recordMatch(match('a'));
    await recordMatch(match('game-1', { winnerNames: ['Alice'] }));
    const updated = await recordMatch(match('game-1', { winnerNames: ['Bob'] }));

    expect(updated.map(m => m.id)).toEqual(['game-1', 'a']);
    expect(updated[0]!.winnerNames).toEqual(['Bob']);
  });

  it('stores ongoing games and preserves a completed replay with another id', async () => {
    const ongoing = match('game-instance', { status: 'ongoing', gameKey: '42|Alice|Bob', finishedAt: 0 });
    await recordOngoingMatch(ongoing);
    await recordOngoingMatch({ ...ongoing, id: 'disconnect-duplicate' });
    expect((await loadMatchHistory()).filter(isOngoingMatch)).toHaveLength(1);
    await recordMatch(match('completed-instance', { status: 'completed', gameKey: '42|Alice|Bob' }));

    const history = await loadMatchHistory();
    expect(history).toHaveLength(1);
    expect(history.filter(isOngoingMatch)).toHaveLength(0);
    expect(history[0]!.id).toBe('completed-instance');
  });

  it('caps the history at 200 matches', async () => {
    let list: MatchResult[] = [];
    for (let i = 0; i < 205; i++) {
      list = await recordMatch(match(`m${i}`));
    }
    expect(list).toHaveLength(200);
    expect(list[0]!.id).toBe('m204');
    expect(list[199]!.id).toBe('m5'); // m0..m4 dropped off the end
    expect(await loadMatchHistory()).toHaveLength(200);
  });

  it('returns [] on corrupt JSON', async () => {
    store.set('jeopardy/match-history', 'not json{{{');
    expect(await loadMatchHistory()).toEqual([]);

    // Non-array JSON is rejected too
    store.set('jeopardy/match-history', '{"nope":true}');
    expect(await loadMatchHistory()).toEqual([]);
  });

  it('returns [] when nothing is stored', async () => {
    expect(await loadMatchHistory()).toEqual([]);
  });
});
