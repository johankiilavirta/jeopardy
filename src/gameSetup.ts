import { normalizeForResume } from './reducer.js';
import type { GameState } from './types.js';

/** Clue count of the 6×5 fallback demo board. */
export const TOTAL_CLUES_DEMO = 30;

// Structural shapes shared by the relay's FullGameData and the app's
// GameData — game setup only cares about clue counts and the final clue,
// so both fit without either side importing the other's types.

export interface SetupCategoryData {
  name: string;
  clues: { value: number; text: string; answer: string }[];
}

export interface SetupGameData {
  round1: SetupCategoryData[];
  round2: SetupCategoryData[];
  final?: { category: string; text: string; answer: string } | undefined;
}

/** Sum of actual clues across categories (incomplete categories count
 *  what they have, so the game ends exactly when the board is empty). */
export function countClues(cats: SetupCategoryData[]): number {
  return cats.reduce((n, c) => n + c.clues.length, 0);
}

/** Validate an untrusted saved state for resuming: a shape check, then
 *  normalization (abandon any in-flight clue, back to the board).
 *  Returns null when the payload isn't a usable GameState. */
export function validateResumeState(state: unknown): GameState | null {
  if (!state || typeof state !== 'object') return null;
  const candidate = state as GameState;
  if (!candidate.players || !Array.isArray(candidate.burnedClueIds)) return null;
  return normalizeForResume(candidate);
}

/** Map game data (or its absence → demo board) and an optional resume
 *  state to the ServerOptions that start the game. Both rounds count
 *  toward totalClues so play spans Jeopardy! + Double Jeopardy!. */
export function buildServerOptions(
  gameData: SetupGameData | null,
  resumeState: GameState | null,
): { totalClues: number; finalClue: { category: string; text: string; answer: string } | null; initialState?: GameState } {
  const totalClues = resumeState
    ? resumeState.totalClues
    : gameData
      ? countClues(gameData.round1) + countClues(gameData.round2)
      : TOTAL_CLUES_DEMO;
  return {
    totalClues,
    finalClue: gameData?.final ?? null,
    ...(resumeState ? { initialState: resumeState } : {}),
  };
}
