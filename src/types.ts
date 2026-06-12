export type GameStatus =
  | 'CHOOSE_CLUE'
  | 'CLUE_READING'
  | 'BUZZ_OPEN'
  | 'CLUE_EXPIRED'
  | 'ANSWER_PHASE'
  | 'ANSWER_LOCKED'
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

/** Server timer: reading lockout is over, the buzz window opens */
export interface BuzzerOpenAction {
  type: 'BUZZER_OPEN';
}

/** Server timer: the expired clue's linger is over, burn it and return to the board */
export interface DismissClueAction {
  type: 'DISMISS_CLUE';
}

/** Server timer: answering time is up — input locks, but judging stays manual */
export interface LockAnswerAction {
  type: 'LOCK_ANSWER';
}

export type Action =
  | SelectClueAction
  | BuzzAction
  | JudgeAnswerAction
  | TimeoutAction
  | BuzzerOpenAction
  | DismissClueAction
  | LockAnswerAction;
