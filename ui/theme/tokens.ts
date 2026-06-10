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
  /** Deep broadcast blue cell fill */
  cell: '#0022B3',
  /** Dead-navy fill for burned (already-played) cells */
  cellBurned: '#0A102E',
  /** Classic gold for dollar values */
  gold: '#E5B20D',
  /** Brighter gold (pressed/highlight accents) */
  goldBright: '#FFCC00',
  /** Grid line color between cells */
  grid: '#000000',
  /** Outline for the player whose turn it is */
  activeOutline: '#2E5BFF',
  /** Dim overlay over the board when it is not the local player's turn */
  dimOverlay: 'rgba(0,0,0,0.4)',
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
