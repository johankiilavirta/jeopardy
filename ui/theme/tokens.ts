/**
 * Design tokens for the Jeopardy UI.
 *
 * Classic Jeopardy! broadcast aesthetic: near-black background, deep
 * broadcast-blue cells, gold condensed values, sharp corners, 2px black
 * grid lines.
 */

export const colors = {
  /** Near-black app background */
  bg: '#0D0D0D',
  /** Deep navy cell fill — softer than the raw broadcast blue (#02029A),
   *  which overwhelms on large surfaces. Used everywhere something is
   *  "Jeopardy blue": board cells, clue card, score blocks, menus. */
  cell: '#111A63',
  /** Dead-navy fill for burned (already-played) cells */
  cellBurned: '#0A102E',
  /** A recessed layer sitting visually "behind" the cell blue — between
   *  cell and the near-black background. */
  cellRecessed: '#0F1440',
  /** Classic gold for dollar values */
  gold: '#E5B20D',
  /** Warmer tan-gold of the broadcast board numbers (rgb 218,157,92) */
  boardValue: '#DA9D5C',
  /** Brighter gold (pressed/highlight accents) */
  goldBright: '#FFCC00',
  /** Grid line color between cells — same as the app background, so the
   *  lines read as the background showing through, not a second black. */
  grid: '#0D0D0D',
  /** Outline for the player whose turn it is */
  activeOutline: '#2E5BFF',
  /** Category header text */
  categoryText: '#FFFFFF',
  /** Revealed behind the clue card on a right (correct) swipe */
  judgeCorrect: '#128A35',
  /** Revealed behind the clue card on a left (incorrect) swipe */
  judgeIncorrect: '#B3231F',
} as const;

/** Corner radius — broadcast boards are sharp. */
export const radius = 1;

export const grid = {
  /** Width of the black grid lines between cells */
  lineWidth: 2,
} as const;

export const type = {
  /** Anton — stand-in for Swiss 911 Ultra Compressed (categories + values) */
  board: 'Anton_400Regular',
  /** Oswald medium — scores, player names, labels */
  ui500: 'Oswald_500Medium',
  /** Oswald bold — emphasized UI text */
  ui700: 'Oswald_700Bold',
} as const;

export const shadow = {
  /** Hard backlit drop shadow behind gold dollar values */
  valueText: {
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 1,
  },
} as const;

/** Opacity of value text on burned cells (0 = fully hidden, ghost by default) */
export const burnedValueOpacity = 0.05;
