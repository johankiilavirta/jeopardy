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

const MATCH_HISTORY_KEY = 'jeopardy/match-history';
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
  /** Same board and player combination, useful for identifying replays. */
  gameKey?: string;
  /** Older records have no status and are completed by definition. */
  status?: 'ongoing' | 'completed';
  startedAt?: number;
  updatedAt?: number;
  finishedAt: number;
  /** J!Archive game number, when known. */
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

/** Canonical identity for one board and one pair of players. */
export function buildGameKey(gameNumber: number | null, players: Pick<MatchPlayerResult, 'name'>[]): string {
  const names = players.map(player => player.name.trim().toLowerCase()).sort();
  return `${gameNumber ?? 'demo'}|${names.join('|')}`;
}

function gameKeyForMatch(match: MatchResult): string {
  return match.gameKey ?? buildGameKey(match.gameNumber, match.players);
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
    return parsed;
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
    const gameKey = gameKeyForMatch(match);
    const updated = [match, ...history.filter(item =>
      item.id !== match.id && !(completed && isOngoingMatch(item) && gameKeyForMatch(item) === gameKey),
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
  const ongoing = {
    ...match,
    id: `${gameKey}|ongoing`,
    gameKey,
    status: 'ongoing',
    updatedAt: Date.now(),
    finishedAt: 0,
  } satisfies MatchResult;
  historyWriteQueue = historyWriteQueue.then(async () => {
    const history = await loadMatchHistory();
    const updated = [ongoing, ...history.filter(item =>
      !isOngoingMatch(item) || gameKeyForMatch(item) !== gameKey,
    )].slice(0, MAX_MATCHES);
    try {
      await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
    } catch {}
    return updated;
  });
  return historyWriteQueue;
}
