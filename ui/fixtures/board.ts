/**
 * Static board definition for the design showcase.
 *
 * `GameState` carries no clue content (only `burnedClueIds` / `totalClues`),
 * so the board layout — category names and per-cell dollar values — comes
 * from this separate structure. In the next milestone this will be supplied
 * by whoever hosts the game.
 */

export interface BoardDefinition {
  categories: {
    name: string;
    clues: { id: number; value: number }[];
  }[];
}

const VALUES = [200, 400, 600, 800, 1000] as const;

const CATEGORY_NAMES = [
  'POTENT POTABLES',
  'WORLD CAPITALS',
  'BEFORE & AFTER',
  'SCIENCE FICTION',
  '4-LETTER WORDS',
  'MOVIE QUOTES',
] as const;

/**
 * Clue ids are laid out column-major: `clueIdAt(col, row) = col * 5 + row`.
 * Column = category index (0–4), row = value tier (0–4).
 */
export function clueIdAt(col: number, row: number): number {
  return col * 5 + row;
}

export const demoBoard: BoardDefinition = {
  categories: CATEGORY_NAMES.map((name, col) => ({
    name,
    clues: VALUES.map((value, row) => ({ id: clueIdAt(col, row), value })),
  })),
};
