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
 * Reduce a full round board (up to 6 categories) to the 5 columns shown on
 * screen.
 *
 * With 6 categories the 6th backfills the slot of the column that was
 * *completed first* — anchored there so it never hops as later columns clear.
 * `burnedClueIds` is append-ordered, so a clue's position is when it was
 * burned and a column "completes" at the position of its last-burned clue;
 * the earliest such position is a stable anchor. The incoming category is
 * marked with a trailing " *". Only this round's own categories are used —
 * a round never borrows a column from another round.
 */
export function getVisibleBoard(full: BoardDefinition, burnedClueIds: number[]): BoardDefinition {
  const sixth = full.categories[5];
  const visible = full.categories.slice(0, 5);
  if (!sixth) return { categories: visible };

  const burnPos = new Map(burnedClueIds.map((id, i) => [id, i] as const));
  let swapSlot = -1;
  let earliest = Infinity;
  for (let col = 0; col < visible.length; col++) {
    const clues = visible[col]!.clues;
    if (clues.length === 0 || !clues.every(c => burnPos.has(c.id))) continue;
    const completedAt = Math.max(...clues.map(c => burnPos.get(c.id)!));
    if (completedAt < earliest) {
      earliest = completedAt;
      swapSlot = col;
    }
  }
  if (swapSlot === -1) return { categories: visible };

  const replaced = [...visible];
  replaced[swapSlot] = { ...sixth, name: `${sixth.name} *` };
  return { categories: replaced };
}

/**
 * Convert a GameData object into the BoardDefinition used by the UI.
 * Clue IDs are laid out column-major: col * 5 + row.
 */
export function toBoardDefinition(game: GameData): BoardDefinition {
  return {
    categories: game.round1.map((cat, col) => ({
      name: cat.name,
      clues: cat.clues.map((clue, row) => ({
        id: clueIdAt(col, row),
        value: clue.value,
      })),
    })),
  };
}

/**
 * Build a clue-content getter matching the `getClueContent` signature.
 * The returned function looks up clue data from the provided game.
 */
export function makeClueGetter(game: GameData): (id: number) => ClueContent {
  return (id: number): ClueContent => {
    const col = Math.floor(id / 5);
    const row = id % 5;
    const category = game.round1[col];
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
