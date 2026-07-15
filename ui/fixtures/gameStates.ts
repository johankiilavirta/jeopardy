/**
 * Named mock GameStates for the design showcase.
 *
 * All fixtures are CHOOSE_CLUE states for two players (`you` / `opponent`)
 * on the 6x5 demo board (totalClues: 30).
 *
 * The fixture uses the same 30-clue shape as a standard live board.
 */

import type { GameState } from '../../src/types';
import { clueIdAt } from './board';

export const LOCAL_PLAYER_ID = 'you';

function makeState(opts: {
  currentTurnPlayerId: string;
  yourScore: number;
  opponentScore: number;
  burnedClueIds: number[];
}): GameState {
  return {
    status: 'CHOOSE_CLUE',
    players: {
      you: { id: 'you', name: 'You', score: opts.yourScore, correct: 0, incorrect: 0, scoreHistory: [0] },
      opponent: { id: 'opponent', name: 'Opponent', score: opts.opponentScore, correct: 0, incorrect: 0, scoreHistory: [0] },
    },
    currentTurnPlayerId: opts.currentTurnPlayerId,
    clueSelectPlayerId: null,
    activeClue: null,
    buzzes: [],
    burnedClueIds: opts.burnedClueIds,
    totalClues: 30,
  };
}

/** Game just started: your pick, empty board, 0–0. */
export const yourTurnFresh = makeState({
  currentTurnPlayerId: 'you',
  yourScore: 0,
  opponentScore: 0,
  burnedClueIds: [],
});

/** Mid-game, opponent's turn (exercises the dim overlay), 8 clues burned. */
export const opponentTurnMidGame = makeState({
  currentTurnPlayerId: 'opponent',
  yourScore: 2200,
  opponentScore: 1400,
  burnedClueIds: [
    clueIdAt(0, 0),
    clueIdAt(0, 1),
    clueIdAt(1, 0),
    clueIdAt(2, 0),
    clueIdAt(2, 1),
    clueIdAt(2, 2),
    clueIdAt(3, 0),
    clueIdAt(4, 1),
  ],
});

/** Late game, your turn, 20 of 30 burned, lopsided scores. */
export const yourTurnLateGame = makeState({
  currentTurnPlayerId: 'you',
  yourScore: 9800,
  opponentScore: -1200,
  burnedClueIds: [
    // Columns 0–2 fully cleared
    ...[0, 1, 2].flatMap(col => [0, 1, 2, 3, 4].map(row => clueIdAt(col, row))),
    // Column 3: all but the $1000
    clueIdAt(3, 0),
    clueIdAt(3, 1),
    clueIdAt(3, 2),
    clueIdAt(3, 3),
    // Column 4: top only
    clueIdAt(4, 0),
  ],
});

export const demoStates = {
  yourTurnFresh,
  opponentTurnMidGame,
  yourTurnLateGame,
} as const;

export type DemoStateName = keyof typeof demoStates;
