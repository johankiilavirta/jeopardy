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

/** Match the board's column-major clue ids (five rows per category). */
export function roundOneClueIds(cats: SetupCategoryData[]): number[] {
  return cats.flatMap((category, column) =>
    category.clues.map((_clue, row) => column * 5 + row),
  );
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
 *  toward totalClues so play spans Round One + Round Two!. */
export function buildServerOptions(
  gameData: SetupGameData | null,
  resumeState: GameState | null,
  buzzerDelay?: number,
  narrationEnabled = false,
): {
  totalClues: number;
  finalClue: { category: string; text: string; answer: string } | null;
  round1ClueIds?: number[];
  readingMs?: number;
  initialState?: GameState;
  narrationEnabled?: boolean;
} {
  const totalClues = resumeState
    ? resumeState.totalClues
    : gameData
      ? countClues(gameData.round1) + countClues(gameData.round2)
      : TOTAL_CLUES_DEMO;
  const readingMs = buzzerDelay != null && Number.isFinite(buzzerDelay) && buzzerDelay >= 0
    ? Math.round(buzzerDelay * 1000)
    : undefined;
  const gameRound1ClueIds = gameData ? roundOneClueIds(gameData.round1) : undefined;
  const initialState = resumeState && gameRound1ClueIds
    ? {
        ...resumeState,
        round1ClueIds: resumeState.round1ClueIds ?? gameRound1ClueIds,
      }
    : resumeState;
  return {
    totalClues,
    finalClue: gameData?.final ?? null,
    ...(gameRound1ClueIds ? { round1ClueIds: gameRound1ClueIds } : {}),
    ...(narrationEnabled ? { narrationEnabled: true } : {}),
    ...(readingMs != null ? { readingMs } : {}),
    ...(initialState ? { initialState } : {}),
  };
}
