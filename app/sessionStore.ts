/**
 * On-device persistence for game continuity (AsyncStorage-backed).
 *
 * Three independent records:
 *  - player name: survives restarts so the server's name-based seat
 *    matching can hand a rejoining player their old seat and score.
 *  - active session: which room we're in and how to reach the relay.
 *    Short-lived — used to auto-rejoin after a lock/kill while the
 *    relay still has the room.
 *  - snapshot: the latest full GameState (plus board data) received
 *    from the server. Outlives the room — powers "Resume game" by
 *    seeding a brand-new room with the saved state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GameState } from '../src/types';
import type { GameData } from '../data/gameLoader';

const SESSION_KEY = 'jeopardy/session';
const SNAPSHOT_STATE_KEY = 'jeopardy/snapshot-state';
const SNAPSHOT_BOARD_KEY = 'jeopardy/snapshot-board';
const PLAYER_NAME_KEY = 'jeopardy/player-name';

/** Rooms live in relay memory; a session older than this is certainly dead. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Trailing debounce for snapshot writes (states arrive on every keystroke). */
const SNAPSHOT_DEBOUNCE_MS = 1000;

export interface SavedSession {
  roomCode: number;
  playerName: string;
  relayHost: string;
  relayPort: string;
  savedAt: number;
}

export interface SavedSnapshot {
  state: GameState;
  board: GameData | null;
  savedAt: number;
}

// --- Player name ---

export async function savePlayerName(name: string): Promise<void> {
  try { await AsyncStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
}

export async function loadPlayerName(): Promise<string | null> {
  try { return await AsyncStorage.getItem(PLAYER_NAME_KEY); } catch { return null; }
}

// --- Active session (rejoin) ---

export async function saveSession(session: Omit<SavedSession, 'savedAt'>): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
  } catch {}
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SavedSession;
    if (typeof session.roomCode !== 'number' || Date.now() - session.savedAt > SESSION_TTL_MS) {
      await AsyncStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try { await AsyncStorage.removeItem(SESSION_KEY); } catch {}
}

// --- Live-game snapshot (resume) ---

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

/** Persist the latest state, debounced. GAME_OVER states are not saved —
 *  a finished game has nothing to resume (the history archive, later,
 *  is where finished games will go). */
export function saveSnapshotState(state: GameState): void {
  if (state.status === 'GAME_OVER') return;
  if (snapshotTimer != null) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    AsyncStorage.setItem(
      SNAPSHOT_STATE_KEY,
      JSON.stringify({ state, savedAt: Date.now() }),
    ).catch(() => {});
  }, SNAPSHOT_DEBOUNCE_MS);
}

/** Board data is large-ish and constant per game: written once at game start. */
export async function saveSnapshotBoard(board: GameData | null): Promise<void> {
  try {
    if (board) await AsyncStorage.setItem(SNAPSHOT_BOARD_KEY, JSON.stringify(board));
    else await AsyncStorage.removeItem(SNAPSHOT_BOARD_KEY);
  } catch {}
}

export async function loadSnapshot(): Promise<SavedSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_STATE_KEY);
    if (!raw) return null;
    const { state, savedAt } = JSON.parse(raw) as { state: GameState; savedAt: number };
    if (!state || typeof state !== 'object' || !state.players || state.status === 'GAME_OVER') {
      return null;
    }
    const boardRaw = await AsyncStorage.getItem(SNAPSHOT_BOARD_KEY);
    return { state, board: boardRaw ? (JSON.parse(boardRaw) as GameData) : null, savedAt };
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  if (snapshotTimer != null) {
    clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  try {
    await AsyncStorage.multiRemove([SNAPSHOT_STATE_KEY, SNAPSHOT_BOARD_KEY]);
  } catch {}
}
