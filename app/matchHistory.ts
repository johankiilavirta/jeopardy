/**
 * On-device match history (AsyncStorage-backed).
 *
 * Every finished game is recorded locally on each device — host and
 * joiners alike — newest first, capped. Records are upserted by id so
 * undoing out of GAME_OVER and re-finishing replaces the entry instead
 * of duplicating it. Powers the last-5 chips on the GAME OVER screen;
 * history screens use the saved stats to recreate the GAME OVER summary.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GameData } from '../data/gameLoader';
import type { SessionMode } from './sessionProvider';
import type { GameState } from '../src/types';

const MATCH_HISTORY_KEY = 'je-trivia/match-history';
const MAX_MATCHES = 200;

export interface MatchPlayerResult {
  name: string;
  score: number;
  correct: number;
  incorrect: number;
  /** Optional so records written by older app versions remain readable. */
  buzzCount?: number | undefined;
  firstBuzzCount?: number | undefined;
  reactionMsTotal?: number | undefined;
  scoreHistory?: number[] | undefined;
  finalWager?: number | undefined;
}

export interface MatchResult {
  /** Stable per-game instance id — recording twice upserts. */
  id: string;
  /** Identity of this actual play-through. It survives reconnects and host
   *  migration; replaying the same board creates a different instance. */
  matchInstanceId?: string;
  /** Same board and player combination, useful for identifying replays. */
  gameKey?: string;
  /** Player whose device wrote this record. Optional for legacy entries. */
  localPlayerName?: string;
  /** Older records have no status and are completed by definition. */
  status?: 'ongoing' | 'completed';
  startedAt?: number;
  updatedAt?: number;
  finishedAt: number;
  /** Source game number, when known. */
  gameNumber: number | null;
  players: MatchPlayerResult[];
  /** All names sharing the top score (more than one on a tie). */
  winnerNames: string[];
  /** Present only while a game is ongoing; used to seed a new lobby. */
  state?: GameState;
  board?: GameData | null;
  mode?: SessionMode;
}

export function isOngoingMatch(match: MatchResult): boolean {
  return match.status === 'ongoing';
}

function normalizePlayerName(name: string): string {
  return name.trim().toLowerCase();
}

/** Canonical identity for one board and one set of players. The local player
 * is first so records from different usernames remain independently scoped. */
export function buildGameKey(
  gameNumber: number | null,
  players: Pick<MatchPlayerResult, 'name'>[],
  localPlayerName?: string,
): string {
  const names = players.map(player => normalizePlayerName(player.name));
  const localName = localPlayerName ? normalizePlayerName(localPlayerName) : '';
  if (localName) {
    const localIndex = names.indexOf(localName);
    if (localIndex >= 0) names.splice(localIndex, 1);
    names.sort();
    names.unshift(localName);
  } else {
    names.sort();
  }
  return `${gameNumber ?? 'demo'}|${names.join('|')}`;
}

function gameKeyForMatch(match: MatchResult): string {
  return match.gameKey ?? buildGameKey(match.gameNumber, match.players, match.localPlayerName);
}

function instanceIdForMatch(match: MatchResult): string {
  return match.matchInstanceId ?? match.id.replace(/\|(ongoing|completed)$/, '');
}

/**
 * Early versions saved a fresh record for each reconnect without a stable
 * match instance id. Ongoing snapshots describe the same game when their
 * board and player key match, so retain only the newest one while reading
 * history. Completed legacy records remain separate: they may be replays.
 */
function displayIdentity(match: MatchResult): string {
  return match.matchInstanceId
    ? `instance:${match.matchInstanceId}`
    : isOngoingMatch(match)
      ? `legacy-ongoing:${gameKeyForMatch(match)}`
      : `record:${match.id}`;
}

/** New records have an explicit owner. Legacy records belong to a username
 * only when that name appears in their player list. */
export function matchBelongsToPlayer(match: MatchResult, playerName: string): boolean {
  const normalized = normalizePlayerName(playerName);
  if (!normalized) return false;
  if (match.localPlayerName != null) {
    return normalizePlayerName(match.localPlayerName) === normalized;
  }
  return match.players.some(player => normalizePlayerName(player.name) === normalized);
}

export function computeWinnerNames(players: MatchPlayerResult[]): string[] {
  if (players.length === 0) return [];
  const maxScore = Math.max(...players.map(p => p.score));
  return players.filter(p => p.score === maxScore).map(p => p.name);
}

/** Newest first; `[]` on missing or corrupt data. */
export async function loadMatchHistory(): Promise<MatchResult[]> {
  try {
    const raw = await AsyncStorage.getItem(MATCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MatchResult[];
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter(match => {
      const identity = displayIdentity(match);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  } catch {
    return [];
  }
}

/** Upsert a finished game and return the updated list (newest first),
 *  so callers never race a read against the write. */
let historyWriteQueue: Promise<MatchResult[]> = Promise.resolve([]);

export function recordMatch(match: MatchResult): Promise<MatchResult[]> {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await loadMatchHistory();
    const completed = !isOngoingMatch(match);
    const instanceId = instanceIdForMatch(match);
    const updated = [match, ...history.filter(item =>
      item.id !== match.id &&
      !(completed && isOngoingMatch(item) && instanceIdForMatch(item) === instanceId),
    )].slice(0, MAX_MATCHES);
    try {
      await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {}
    return updated;
  });
  return historyWriteQueue;
}

/** Save the latest playable state without disturbing a completed replay with
 * the same board/player key. The caller gives each game instance its own id. */
export async function recordOngoingMatch(match: MatchResult): Promise<MatchResult[]> {
  const gameKey = gameKeyForMatch(match);
  const matchInstanceId = instanceIdForMatch(match);
  const ongoing = {
    ...match,
    id: `${matchInstanceId}|ongoing`,
    matchInstanceId,
    gameKey,
    status: 'ongoing',
    updatedAt: Date.now(),
    finishedAt: 0,
  } satisfies MatchResult;
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await loadMatchHistory();
    const updated = [ongoing, ...history.filter(item =>
      !isOngoingMatch(item) || instanceIdForMatch(item) !== matchInstanceId,
    )].slice(0, MAX_MATCHES);
    try {
      await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {}
    return updated;
  });
  return historyWriteQueue;
}

/** Remove an abandoned/no-progress ongoing entry without touching completed
 * matches or other resumable games. */
export function removeOngoingMatch(matchInstanceId: string): Promise<MatchResult[]> {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await loadMatchHistory();
    const updated = history.filter(item =>
      !isOngoingMatch(item) || instanceIdForMatch(item) !== matchInstanceId,
    );
    try {
      await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {}
    return updated;
  });
  return historyWriteQueue;
}

/** Remove exactly one local history tile. */
export function deleteMatchHistoryEntry(id: string): Promise<MatchResult[]> {
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await loadMatchHistory();
    const updated = history.filter(item => item.id !== id);
    try {
      await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {}
    return updated;
  });
  return historyWriteQueue;
}
