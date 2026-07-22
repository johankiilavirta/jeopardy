/**
 * On-device match history (AsyncStorage-backed).
 *
 * Every finished game is recorded locally on each device — host and
 * joiners alike — newest first, capped. Records are upserted by id so
 * undoing out of GAME_OVER and re-finishing replaces the entry instead
 * of duplicating it. Powers the last-5 chips on the GAME OVER screen;
 * lifetime stats / a match-history UI can build on it later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MATCH_HISTORY_KEY = 'jeopardy/match-history';
const MAX_MATCHES = 200;

export interface MatchPlayerResult {
  name: string;
  score: number;
  correct: number;
  incorrect: number;
}

export interface MatchResult {
  /** Stable per-game id (assigned at game start) — recording twice upserts. */
  id: string;
  finishedAt: number;
  /** J!Archive game number, when known. */
  gameNumber: number | null;
  players: MatchPlayerResult[];
  /** All names sharing the top score (more than one on a tie). */
  winnerNames: string[];
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
export async function recordMatch(match: MatchResult): Promise<MatchResult[]> {
  const history = await loadMatchHistory();
  const updated = [match, ...history.filter(m => m.id !== match.id)].slice(0, MAX_MATCHES);
  try {
    await AsyncStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}
