import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../reducer.js';
import type { GameData } from '../../data/gameLoader';

/** In-memory AsyncStorage stand-in (no native storage under vitest). */
const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    map,
    module: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => { map.set(key, value); },
      removeItem: async (key: string) => { map.delete(key); },
      multiRemove: async (keys: string[]) => { keys.forEach(k => map.delete(k)); },
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage.module }));

import {
  loadSession,
  loadSnapshot,
  saveSession,
  saveSnapshotBoard,
  saveSnapshotState,
} from '../../app/sessionStore';

const board: GameData = {
  gameNumber: 42,
  airDate: '1990-01-01',
  round1: [{ name: 'CAT', clues: [{ value: 200, text: 'Q', answer: 'A' }] }],
  round2: [],
};

function seedSnapshotState(): void {
  storage.map.set(
    'jeopardy/snapshot-state',
    JSON.stringify({ state: createInitialState(['Alice', 'Bob'], 6), savedAt: 1 }),
  );
}

describe('sessionStore', () => {
  beforeEach(() => storage.map.clear());
  afterEach(() => vi.useRealTimers());

  it('round-trips a session including mode and isHost', async () => {
    await saveSession({ mode: 'nearby', roomCode: 423, playerName: 'Alice', relayHost: 'localhost', relayPort: '8787', isHost: true });
    const session = await loadSession();
    expect(session).toMatchObject({ mode: 'nearby', roomCode: 423, playerName: 'Alice', isHost: true });
  });

  it('defaults legacy sessions (no mode/isHost) to an online guest', async () => {
    storage.map.set(
      'jeopardy/session',
      JSON.stringify({ roomCode: 512, playerName: 'Bob', relayHost: 'h', relayPort: '8787', savedAt: Date.now() }),
    );
    const session = await loadSession();
    expect(session?.mode).toBe('online');
    expect(session?.isHost).toBe(false);
  });

  it('round-trips a snapshot with board and mode', async () => {
    vi.useFakeTimers();
    saveSnapshotState(createInitialState(['Alice', 'Bob'], 6));
    await vi.advanceTimersByTimeAsync(1000); // past the write debounce
    await saveSnapshotBoard(board, 'nearby');

    const snapshot = await loadSnapshot();
    expect(snapshot?.mode).toBe('nearby');
    expect(snapshot?.board?.gameNumber).toBe(42);
    expect(snapshot?.state.players['alice']?.name).toBe('Alice');
  });

  it('records the mode even for a null (demo) board', async () => {
    seedSnapshotState();
    await saveSnapshotBoard(null, 'nearby');
    const snapshot = await loadSnapshot();
    expect(snapshot?.board).toBeNull();
    expect(snapshot?.mode).toBe('nearby');
  });

  it('reads legacy raw-GameData board records as online', async () => {
    seedSnapshotState();
    storage.map.set('jeopardy/snapshot-board', JSON.stringify(board));
    const snapshot = await loadSnapshot();
    expect(snapshot?.board?.gameNumber).toBe(42);
    expect(snapshot?.mode).toBe('online');
  });

  it('defaults to online when no board record exists at all', async () => {
    seedSnapshotState();
    const snapshot = await loadSnapshot();
    expect(snapshot?.board).toBeNull();
    expect(snapshot?.mode).toBe('online');
  });
});
