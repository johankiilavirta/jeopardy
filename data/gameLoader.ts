/**
 * Runtime loader for user-imported game data.
 *
 * The App Store build contains no question archive. A player imports one
 * standalone JSON array in Settings; app/questionLibrary indexes that file
 * and this module retains the board conversion helpers used by the UI.
 */

import type { BoardDefinition } from '../ui/fixtures/board';
import { clueIdAt } from '../ui/fixtures/board';
import type { ClueContent } from '../ui/fixtures/clues';
import { getImportedGameCount, loadImportedGame } from './importedGameStore';
import { STARTER_GAME } from './starterGame';
import { sanitizeText } from '../src/sanitizeText';

// ── Types ──────────────────────────────────────────────────────────

export interface CategoryData {
  name: string;
  clues: { value: number; text: string; answer: string }[];
}

export interface GameData {
  gameNumber: number;
  airDate: string;
  round1: CategoryData[];
  round2: CategoryData[];
  final?: { category: string; text: string; answer: string };
}

export interface GameIndex {
  totalGames: number;
  seasons: { file: string; startGame: number; endGame: number }[];
}

/** Lightweight metadata used by the game-selection preview. */
export interface GameInfo {
  airDate: string;
  season: number | null;
  round1: { name: string; clueCount: number }[];
  round2: { name: string; clueCount: number }[];
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Load the game index. Returns cached result on subsequent calls.
 */
export function loadGameIndex(): GameIndex {
  // Game 0 is always available but intentionally excluded from this count so
  // random selection uses imported games whenever the user has loaded them.
  const totalGames = getImportedGameCount();
  return {
    totalGames,
    seasons: totalGames > 0
      ? [{ file: 'imported-question-library.json', startGame: 1, endGame: totalGames }]
      : [],
  };
}

/**
 * Find and return a specific game by its sequential game number.
 */
export function loadGame(gameNumber: number): GameData | null {
  if (gameNumber === 0) return STARTER_GAME;
  return loadImportedGame(gameNumber);
}

/**
 * Read selection metadata from the imported archive. Nearby and Bluetooth
 * games never need an internet relay merely to preview a chosen game.
 */
export function loadGameInfo(gameNumber: number): GameInfo | null {
  const game = loadGame(gameNumber);
  if (!game) return null;

  const year = Number.parseInt(game.airDate.slice(0, 4), 10);
  const categories = (round: CategoryData[]) => round.map(category => ({
    name: sanitizeText(category.name),
    clueCount: category.clues.length,
  }));

  return {
    airDate: game.airDate,
    season: Number.isFinite(year) && year >= 1984 ? year - 1983 : null,
    round1: categories(game.round1),
    round2: categories(game.round2),
  };
}

/**
 * Pick a random game number from 1..total.
 */
export function getRandomGameNumber(total: number): number {
  return Math.floor(Math.random() * total) + 1;
}

/**
 * Reduce a full round board (up to 6 categories) to `visibleCount` columns.
 *
 * Reserve categories (those beyond `visibleCount`) backfill completed columns
 * as early as possible: the first reserve replaces the first-completed column,
 * the second reserve replaces the second-completed column, etc. Backfilled
 * names are marked with a trailing " *" so players know a new category has
 * arrived (omitted when all 6 categories are visible from the start).
 *
 * `burnedClueIds` is append-ordered: a clue's position equals when it was
 * burned, and a column "completes" at the position of its last-burned clue.
 */
export function getVisibleBoard(
  full: BoardDefinition,
  burnedClueIds: number[],
  visibleCount: number = 6,
): BoardDefinition {
  const totalCats = full.categories.length;
  const showCount = Math.min(visibleCount, totalCats);

  if (showCount >= totalCats) {
    return { categories: full.categories };
  }

  const visible = full.categories.slice(0, showCount);
  const reserves = full.categories.slice(showCount);
  if (reserves.length === 0) return { categories: visible };

  const burnPos = new Map(burnedClueIds.map((id, i) => [id, i] as const));

  // Collect original visible columns that are fully burned, sorted earliest first.
  const completions: { col: number; completedAt: number }[] = [];
  for (let col = 0; col < visible.length; col++) {
    const clues = visible[col]!.clues;
    if (clues.length === 0 || !clues.every(c => burnPos.has(c.id))) continue;
    completions.push({ col, completedAt: Math.max(...clues.map(c => burnPos.get(c.id)!)) });
  }
  completions.sort((a, b) => a.completedAt - b.completedAt);

  const replaced = [...visible];
  for (let i = 0; i < Math.min(completions.length, reserves.length); i++) {
    const reserve = reserves[i]!;
    replaced[completions[i]!.col] = { ...reserve, name: `${reserve.name} *` };
  }
  return { categories: replaced };
}

export type RoundNumber = 1 | 2;

/**
 * Clue-id space reserved per round: 6 categories × 5 rows. Round 1 owns ids
 * 0..29, round 2 owns 30..59, so a clue id encodes which round it belongs to
 * and the two rounds never collide in `burnedClueIds`.
 */
export const ROUND_STRIDE = 30;

function roundCategories(game: GameData, round: RoundNumber): CategoryData[] {
  return round === 2 ? (game.round2 ?? []) : game.round1;
}

/**
 * Convert one round of a GameData object into the BoardDefinition used by the
 * UI. Clue IDs are laid out column-major (col * 5 + row) and offset by round.
 */
export function toBoardDefinition(game: GameData, round: RoundNumber = 1): BoardDefinition {
  const offset = (round - 1) * ROUND_STRIDE;
  return {
    categories: roundCategories(game, round).map((cat, col) => ({
      name: sanitizeText(cat.name),
      clues: cat.clues.map((clue, row) => ({
        id: offset + clueIdAt(col, row),
        value: clue.value,
      })),
    })),
  };
}

/**
 * Build a clue-content getter matching the `getClueContent` signature. The
 * clue id's range selects the round, so a single getter serves both rounds.
 */
export function makeClueGetter(game: GameData): (id: number) => ClueContent {
  return (id: number): ClueContent => {
    const round: RoundNumber = id >= ROUND_STRIDE ? 2 : 1;
    const localId = id - (round - 1) * ROUND_STRIDE;
    const col = Math.floor(localId / 5);
    const row = localId % 5;
    const category = roundCategories(game, round)[col];
    const clue = category?.clues[row];

    if (!category || !clue) {
      throw new Error(`No clue content for id ${id} in game #${game.gameNumber}`);
    }

    return {
      id,
      category: sanitizeText(category.name),
      text: sanitizeText(clue.text),
      answer: sanitizeText(clue.answer),
      value: clue.value,
    };
  };
}
