export type GameStatus =
  | 'CHOOSE_CLUE'
  | 'CLUE_READING'
  | 'ANSWER_PHASE'
  | 'GAME_OVER';

export interface Player {
  id: string;
  name: string;
  score: number;
}

export interface ActiveClue {
  id: number;
  category: string;
  text: string;
  answer: string;
  value: number;
  /** Which players have already attempted and failed this clue */
  failedPlayerIds: string[];
}

export interface GameState {
  status: GameStatus;
  players: Record<string, Player>;
  /** Who picks the next clue (null = anyone can pick first clue) */
  currentTurnPlayerId: string | null;
  /** Who originally selected this clue */
  clueSelectPlayerId: string | null;
  activeClue: ActiveClue | null;
  /** Who buzzed in and is currently answering */
  answeringPlayerId: string | null;
  burnedClueIds: number[];
  /** Board dimensions */
  totalClues: number;
}

// --- Actions ---

export interface SelectClueAction {
  type: 'SELECT_CLUE';
  playerId: string;
  clue: { id: number; category: string; text: string; answer: string; value: number };
}

export interface BuzzAction {
  type: 'BUZZ';
  playerId: string;
}

export interface JudgeAnswerAction {
  type: 'JUDGE_ANSWER';
  playerId: string;
  correct: boolean;
}

export interface TimeoutAction {
  type: 'TIMEOUT';
}

export type Action = SelectClueAction | BuzzAction | JudgeAnswerAction | TimeoutAction;
