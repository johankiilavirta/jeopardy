export type GameStatus =
  | 'CHOOSE_CLUE'
  | 'CLUE_READING'
  | 'BUZZ_OPEN'
  | 'CLUE_EXPIRED'
  | 'ANSWERING'
  | 'REVEAL'
  | 'GAME_OVER';

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
  /** Input is closed: swiped down, or their personal timer expired. */
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
  | SkipClueAction;
