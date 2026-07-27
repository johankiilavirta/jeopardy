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
      multiSet: async (entries: [string, string][]) => {
        entries.forEach(([key, value]) => map.set(key, value));
      },
      multiRemove: async (keys: string[]) => { keys.forEach(k => map.delete(k)); },
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage.module }));

import {
  loadSession,
  loadSnapshot,
  saveSession,
  saveInitialSnapshot,
  saveSnapshotBoard,
  saveSnapshotState,
  loadTextToSpeechEnabled,
  saveTextToSpeechEnabled,
} from '../../app/sessionStore';

const board: GameData = {
  gameNumber: 42,
  airDate: '1990-01-01',
  round1: [{ name: 'CAT', clues: [{ value: 200, text: 'Q', answer: 'A' }] }],
  round2: [],
};

function seedSnapshotState(): void {
  const state = createInitialState(['Alice', 'Bob'], 6);
  state.burnedClueIds = [0];
  storage.map.set(
    'je-trivia/snapshot-state',
    JSON.stringify({ state, savedAt: 1 }),
  );
}

describe('sessionStore', () => {
  beforeEach(() => storage.map.clear());
  afterEach(() => vi.useRealTimers());

  it('round-trips a session including mode and isHost', async () => {
    await saveSession({
      mode: 'nearby',
      roomCode: 423,
      playerName: 'Alice',
      relayHost: 'localhost',
      relayPort: '8787',
      roomId: 'room-a',
      epoch: 2,
      leaderId: 'leader-a',
      isHost: true,
      matchInstanceId: 'match-a',
      matchStartedAt: 123,
    });
    const session = await loadSession();
    expect(session).toMatchObject({ mode: 'nearby', roomCode: 423, playerName: 'Alice', roomId: 'room-a', epoch: 2, leaderId: 'leader-a', isHost: true });
  });

  it('round-trips the host text-to-speech preference', async () => {
    expect(await loadTextToSpeechEnabled()).toBeNull();
    await saveTextToSpeechEnabled(true);
    expect(await loadTextToSpeechEnabled()).toBe(true);
    await saveTextToSpeechEnabled(false);
    expect(await loadTextToSpeechEnabled()).toBe(false);
  });

  it('defaults legacy sessions (no mode/isHost/authority) to an online guest', async () => {
    storage.map.set(
      'je-trivia/session',
      JSON.stringify({ roomCode: 512, playerName: 'Bob', relayHost: 'h', relayPort: '8787', savedAt: Date.now() }),
    );
    const session = await loadSession();
    expect(session?.mode).toBe('online');
    expect(session?.isHost).toBe(false);
    expect(session?.roomId).toBe('legacy-online-512');
    expect(session?.epoch).toBe(1);
    expect(session?.leaderId).toBe('');
  });

  it('round-trips a snapshot with board and mode', async () => {
    vi.useFakeTimers();
    const state = createInitialState(['Alice', 'Bob'], 6);
    state.burnedClueIds = [0];
    saveSnapshotState(state, 'match-a', 123);
    await vi.advanceTimersByTimeAsync(1000); // past the write debounce
    await saveSnapshotBoard(board, 'nearby');

    const snapshot = await loadSnapshot();
    expect(snapshot?.mode).toBe('nearby');
    expect(snapshot?.board?.gameNumber).toBe(42);
    expect(snapshot?.state.players['alice']?.name).toBe('Alice');
    expect(snapshot?.matchInstanceId).toBe('match-a');
    expect(snapshot?.matchStartedAt).toBe(123);
  });

  it('saves and loads a game with no completed clues', async () => {
    vi.useFakeTimers();
    saveSnapshotState(createInitialState(['Alice', 'Bob'], 6), 'match-empty', 456);
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = await loadSnapshot();
    expect(snapshot?.state.burnedClueIds).toEqual([]);
    expect(snapshot?.matchInstanceId).toBe('match-empty');
  });

  it('establishes a zero-progress board and state as one resumable snapshot', async () => {
    const state = createInitialState(['Alice', 'Bob'], 6);
    await saveInitialSnapshot(state, board, 'bluetooth', 'match-initial', 789);

    const snapshot = await loadSnapshot();
    expect(snapshot).toMatchObject({
      mode: 'bluetooth',
      matchInstanceId: 'match-initial',
      matchStartedAt: 789,
    });
    expect(snapshot?.board?.gameNumber).toBe(42);
    expect(snapshot?.state.burnedClueIds).toEqual([]);
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
    storage.map.set('je-trivia/snapshot-board', JSON.stringify(board));
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
