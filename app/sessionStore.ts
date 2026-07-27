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
import type { SessionMode } from './sessionProvider';
import { legacyRoomId, normalizeEpoch, normalizeLeaderId } from './sessionAuthority';

const SESSION_KEY = 'je-trivia/session';
const SNAPSHOT_STATE_KEY = 'je-trivia/snapshot-state';
const SNAPSHOT_BOARD_KEY = 'je-trivia/snapshot-board';
const PLAYER_NAME_KEY = 'je-trivia/player-name';
const CONNECTION_MODE_KEY = 'je-trivia/connection-mode';
const VIBRATION_ENABLED_KEY = 'je-trivia/vibration-enabled';
const TEXT_TO_SPEECH_ENABLED_KEY = 'je-trivia/text-to-speech-enabled';

/** The transport used by the next game created or joined from the menu. */
export type PreferredConnectionMode = 'bluetooth' | 'online';

/** Rooms live in relay memory; a session older than this is certainly dead. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Trailing debounce for snapshot writes (states arrive on every keystroke). */
const SNAPSHOT_DEBOUNCE_MS = 1000;

export interface SavedSession {
  mode: SessionMode;
  roomCode: number;
  playerName: string;
  relayHost: string;
  relayPort: string;
  /** Stable identity for this game instance, independent of reused room codes. */
  roomId: string;
  /** Monotonic leadership version. A promoted local host increments it. */
  epoch: number;
  /** Deterministic tie-breaker when competing hosts claim the same epoch. */
  leaderId: string;
  /** Whether this device currently believes it is the authoritative host. */
  isHost: boolean;
  /** Stable identity for match-history upserts across reconnect/failover. */
  matchInstanceId: string;
  matchStartedAt: number;
  savedAt: number;
}

export interface SavedSnapshot {
  state: GameState;
  board: GameData | null;
  matchInstanceId: string;
  matchStartedAt: number;
  /** Connection mode the snapshot was taken in — RESUME GAME re-hosts
   *  the same kind of room. */
  mode: SessionMode;
  savedAt: number;
}

// --- Player name ---

export async function savePlayerName(name: string): Promise<void> {
  try { await AsyncStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
}

export async function loadPlayerName(): Promise<string | null> {
  try { return await AsyncStorage.getItem(PLAYER_NAME_KEY); } catch { return null; }
}

// --- Connection preference ---

export async function savePreferredConnectionMode(mode: PreferredConnectionMode): Promise<void> {
  try { await AsyncStorage.setItem(CONNECTION_MODE_KEY, JSON.stringify({ mode })); } catch {}
}

export async function loadPreferredConnectionMode(): Promise<PreferredConnectionMode | null> {
  try {
    const raw = await AsyncStorage.getItem(CONNECTION_MODE_KEY);
    if (!raw) return null;
    const { mode } = JSON.parse(raw) as { mode?: unknown };
    return mode === 'bluetooth' || mode === 'online' ? mode : null;
  } catch {
    // The first version stored an unversioned string. Treat it as unset so
    // existing installs pick up the current default once.
    return null;
  }
}

// --- Local vibration preference ---

export async function saveVibrationEnabled(enabled: boolean): Promise<void> {
  try { await AsyncStorage.setItem(VIBRATION_ENABLED_KEY, JSON.stringify({ enabled })); } catch {}
}

export async function loadVibrationEnabled(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(VIBRATION_ENABLED_KEY);
    if (!raw) return null;
    const { enabled } = JSON.parse(raw) as { enabled?: unknown };
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  }
}

// --- Host clue narration preference ---

export async function saveTextToSpeechEnabled(enabled: boolean): Promise<void> {
  try { await AsyncStorage.setItem(TEXT_TO_SPEECH_ENABLED_KEY, JSON.stringify({ enabled })); } catch {}
}

export async function loadTextToSpeechEnabled(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(TEXT_TO_SPEECH_ENABLED_KEY);
    if (!raw) return null;
    const { enabled } = JSON.parse(raw) as { enabled?: unknown };
    return typeof enabled === 'boolean' ? enabled : null;
  } catch {
    return null;
  }
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
    const parsed = JSON.parse(raw) as Omit<SavedSession, 'mode' | 'isHost' | 'matchInstanceId' | 'matchStartedAt'> & {
      mode?: SavedSession['mode'];
      isHost?: boolean;
      roomId?: string;
      epoch?: number;
      leaderId?: string;
      matchInstanceId?: string;
      matchStartedAt?: number;
    };
    // Sessions saved before connection modes existed were all relay rooms;
    // before isHost/authority existed, reconnecting never depended on role
    // or leader version.
    const mode = parsed.mode ?? 'online';
    const session: SavedSession = {
      ...parsed,
      mode,
      roomId: parsed.roomId ?? legacyRoomId(mode, parsed.roomCode),
      epoch: normalizeEpoch(parsed.epoch),
      leaderId: normalizeLeaderId(parsed.leaderId),
      isHost: parsed.isHost ?? false,
      matchInstanceId: parsed.matchInstanceId ?? parsed.roomId ?? legacyRoomId(mode, parsed.roomCode),
      matchStartedAt: parsed.matchStartedAt ?? parsed.savedAt,
    };
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

/** Persist the latest playable state, including a brand-new board with no
 * completed clues. The explicit match identity prevents failover from
 * creating a second history entry for the same play-through. */
export function saveSnapshotState(state: GameState, matchInstanceId: string, matchStartedAt: number): void {
  if (state.status === 'GAME_OVER') return;
  if (snapshotTimer != null) clearTimeout(snapshotTimer);
  const write = () => {
    snapshotTimer = null;
    AsyncStorage.setItem(
      SNAPSHOT_STATE_KEY,
      JSON.stringify({ state, matchInstanceId, matchStartedAt, savedAt: Date.now() }),
    ).catch(() => {});
  };
  if (state.burnedClueIds.length === 0) {
    write();
    return;
  }
  snapshotTimer = setTimeout(() => {
    write();
  }, SNAPSHOT_DEBOUNCE_MS);
}

/** Board data is large-ish and constant per game: written once at game
 *  start. Written even for a null (demo) board — the envelope also records
 *  which connection mode the game was played in. */
export async function saveSnapshotBoard(board: GameData | null, mode: SessionMode): Promise<void> {
  try {
    await AsyncStorage.setItem(SNAPSHOT_BOARD_KEY, JSON.stringify({ board, mode }));
  } catch {}
}

/** Atomically establish the board/state pair for a newly mounted game. This
 * also covers a zero-progress board, so an immediate crash cannot leave a
 * new state paired with the previous match's question data. */
export async function saveInitialSnapshot(
  state: GameState,
  board: GameData | null,
  mode: SessionMode,
  matchInstanceId: string,
  matchStartedAt: number,
): Promise<void> {
  if (state.status === 'GAME_OVER') return;
  const savedAt = Date.now();
  try {
    await AsyncStorage.multiSet([
      [
        SNAPSHOT_STATE_KEY,
        JSON.stringify({ state, matchInstanceId, matchStartedAt, savedAt }),
      ],
      [
        SNAPSHOT_BOARD_KEY,
        JSON.stringify({ board, mode }),
      ],
    ]);
  } catch {}
}

export async function loadSnapshot(): Promise<SavedSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_STATE_KEY);
    if (!raw) return null;
    const parsedState = JSON.parse(raw) as {
      state: GameState;
      matchInstanceId?: string;
      matchStartedAt?: number;
      savedAt: number;
    };
    const { state, savedAt } = parsedState;
    if (
      !state ||
      typeof state !== 'object' ||
      !state.players ||
      state.status === 'GAME_OVER' ||
      !Array.isArray(state.burnedClueIds)
    ) {
      return null;
    }
    const boardRaw = await AsyncStorage.getItem(SNAPSHOT_BOARD_KEY);
    let board: GameData | null = null;
    let mode: SavedSnapshot['mode'] = 'online';
    if (boardRaw) {
      const parsed = JSON.parse(boardRaw) as { board?: GameData | null; mode?: SavedSnapshot['mode'] } | GameData;
      if (parsed && typeof parsed === 'object' && 'mode' in parsed) {
        board = parsed.board ?? null;
        mode = parsed.mode ?? 'online';
      } else {
        // Legacy record: the raw GameData itself (always an online game).
        board = parsed as GameData;
      }
    }
    return {
      state,
      board,
      mode,
      matchInstanceId: parsedState.matchInstanceId ?? `legacy-snapshot-${savedAt}`,
      matchStartedAt: parsedState.matchStartedAt ?? savedAt,
      savedAt,
    };
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
