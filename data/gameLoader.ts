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

export interface GameData {
  gameNumber: number;
  airDate: string;
  categories: {
    name: string;
    clues: { value: number; text: string; answer: string }[];
  }[];
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
 * Convert a GameData object into the BoardDefinition used by the UI.
 * Clue IDs are laid out column-major: col * 5 + row.
 */
export function toBoardDefinition(game: GameData): BoardDefinition {
  return {
    categories: game.categories.map((cat, col) => ({
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
    const category = game.categories[col];
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
