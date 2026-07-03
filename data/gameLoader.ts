/**
 * Runtime loader for J!Archive game data.
 *
 * Season JSON files and the index are bundled with the app via Metro's
 * JSON import support. This module provides helpers to load a specific
 * game by number and convert it to the BoardDefinition / ClueContent
 * types used by the rest of the app.
 */

import type { BoardDefinition } from '../ui/fixtures/board';
import { clueIdAt } from '../ui/fixtures/board';
import type { ClueContent } from '../ui/fixtures/clues';

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
}

export interface GameIndex {
  totalGames: number;
  seasons: { file: string; startGame: number; endGame: number }[];
}

// ── Season file registry ───────────────────────────────────────────
// Metro requires static require() calls — we can't use dynamic paths.
// Register each generated season file here. After running the convert
// script, add entries for every season-YYYY.json that was produced.
//
// Example:
//   const SEASON_FILES: Record<string, GameData[]> = {
//     'season-1984.json': require('./seasons/season-1984.json'),
//     'season-1985.json': require('./seasons/season-1985.json'),
//     ...
//   };
//
// For now this map is empty — it will be populated once the data is
// generated and imports are wired up.

const SEASON_FILES: Record<string, GameData[]> = {};

let _index: GameIndex | null = null;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Load the game index. Returns cached result on subsequent calls.
 */
export function loadGameIndex(): GameIndex {
  if (_index) return _index;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _index = require('./seasons/index.json') as GameIndex;
  } catch {
    _index = { totalGames: 0, seasons: [] };
  }
  return _index;
}

/**
 * Find and return a specific game by its sequential game number.
 */
export function loadGame(gameNumber: number): GameData | null {
  const index = loadGameIndex();

  // Find which season file contains this game number
  const season = index.seasons.find(
    s => gameNumber >= s.startGame && gameNumber <= s.endGame,
  );
  if (!season) return null;

  const games = SEASON_FILES[season.file];
  if (!games) return null;

  return games.find(g => g.gameNumber === gameNumber) ?? null;
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
      name: cat.name,
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
      category: category.name,
      text: clue.text,
      answer: clue.answer,
      value: clue.value,
    };
  };
}
