export type GameStatus =
  | 'CHOOSE_CLUE'
  | 'CLUE_READING'
  | 'BUZZ_OPEN'
  | 'CLUE_EXPIRED'
  | 'ANSWERING'
  | 'REVEAL'
  | 'GAME_OVER'
  | 'FINAL_JEOPARDY_WAGER'
  | 'FINAL_JEOPARDY_ANSWER';

export interface Player {
  id: string;
  name: string;
  score: number;
  correct: number;
  incorrect: number;
  scoreHistory: number[];
}

export interface ActiveClue {
  id: number;
  category: string;
  text: string;
  answer: string;
  value: number;
  /** Which players have already been judged wrong on this clue */
  failedPlayerIds: string[];
}

/** One player's attempt at the active clue, in buzz order. */
export interface Buzz {
  playerId: string;
  /** The answer typed so far (final once `locked`). */
  answer: string;
  /** Input is closed: swiped down, or the applicable answer deadline expired. */
  locked: boolean;
}

export interface GameState {
  status: GameStatus;
  players: Record<string, Player>;
  /** Who picks the next clue (null = anyone can pick first clue) */
  currentTurnPlayerId: string | null;
  /** Who originally selected this clue */
  clueSelectPlayerId: string | null;
  activeClue: ActiveClue | null;
  /** Everyone who buzzed on the active clue, in buzz order */
  buzzes: Buzz[];
  burnedClueIds: number[];
  /** Players who have passed on the active clue via the pull-down skip. */
  passedPlayerIds?: string[];
  /** Board dimensions */
  totalClues: number;
  /** Final Jeopardy clue if available */
  finalClue?: { category: string; text: string; answer: string } | null;
  /** Final wagers submitted by players */
  finalWagers?: Record<string, number>;
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

/** Live keystroke sync while a buzzed player types (dispatched transiently) */
export interface SetAnswerAction {
  type: 'SET_ANSWER';
  playerId: string;
  text: string;
}

export interface JudgeAnswerAction {
  type: 'JUDGE_ANSWER';
  playerId: string;
  correct: boolean;
  penalty?: boolean;
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

/** Host right-clicks a clue to burn it without entering the reading/buzzing flow */
export interface SkipClueAction {
  type: 'SKIP_CLUE';
  playerId: string;
  clueId: number;
}

/** A player passes on the active clue. Once every player has either passed
 *  or locked an answer, the correct answer is shown without judging. */
export interface PassClueAction {
  type: 'PASS_CLUE';
  playerId: string;
}

/** A player's input closes. Swipe-down sends the final text in `answer`;
 *  the server's personal-timer fallback omits it (last synced text stands). */
export interface LockAnswerAction {
  type: 'LOCK_ANSWER';
  playerId: string;
  answer?: string;
}

export interface UnlockAnswerAction {
  type: 'UNLOCK_ANSWER';
  playerId: string;
}

export type Action =
  | SelectClueAction
  | BuzzAction
  | SetAnswerAction
  | JudgeAnswerAction
  | TimeoutAction
  | BuzzerOpenAction
  | DismissClueAction
  | LockAnswerAction
  | UnlockAnswerAction
  | SkipClueAction
  | PassClueAction;
