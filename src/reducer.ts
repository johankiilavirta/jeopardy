import type { GameState, Action, Buzz, Player } from './types.js';

export function createInitialState(playerNames: string[], totalClues = 30): GameState {
  const players: Record<string, Player> = {};
  for (const name of playerNames) {
    const id = name.toLowerCase().replace(/\s+/g, '-');
    players[id] = { id, name, score: 0 };
  }
  return {
    status: 'CHOOSE_CLUE',
    players,
    currentTurnPlayerId: null, // anyone can pick first
    clueSelectPlayerId: null,
    activeClue: null,
    buzzes: [],
    burnedClueIds: [],
    totalClues,
  };
}

// --- Selectors ---

/** The buzz entry for a given player, if they buzzed on the active clue. */
export function getBuzz(state: GameState, playerId: string): Buzz | undefined {
  return state.buzzes.find(b => b.playerId === playerId);
}

/** Every buzzed player has locked their answer (vacuously false with no buzzes). */
export function allBuzzersLocked(state: GameState): boolean {
  return state.buzzes.length > 0 && state.buzzes.every(b => b.locked);
}

/** During REVEAL, whose answer is on the stand: the first buzzer (in buzz
 *  order) not yet judged wrong. Null outside REVEAL or when all are judged. */
export function judgedPlayerId(state: GameState): string | null {
  if (state.status !== 'REVEAL' || !state.activeClue) return null;
  const failed = state.activeClue.failedPlayerIds;
  const next = state.buzzes.find(b => !failed.includes(b.playerId));
  return next ? next.playerId : null;
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SELECT_CLUE':
      return handleSelectClue(state, action);
    case 'BUZZ':
      return handleBuzz(state, action);
    case 'SET_ANSWER':
      return handleSetAnswer(state, action);
    case 'JUDGE_ANSWER':
      return handleJudgeAnswer(state, action);
    case 'TIMEOUT':
      return handleTimeout(state);
    case 'BUZZER_OPEN':
      return handleBuzzerOpen(state);
    case 'DISMISS_CLUE':
      return handleDismissClue(state);
    case 'LOCK_ANSWER':
      return handleLockAnswer(state, action);
    case 'SKIP_CLUE':
      return handleSkipClue(state, action);
    default:
      return state;
  }
}

function handleSelectClue(state: GameState, action: Extract<Action, { type: 'SELECT_CLUE' }>): GameState {
  if (state.status !== 'CHOOSE_CLUE') return state;

  // If there's a designated turn, enforce it
  if (state.currentTurnPlayerId && action.playerId !== state.currentTurnPlayerId) return state;

  // Can't pick an already-burned clue
  if (state.burnedClueIds.includes(action.clue.id)) return state;

  return {
    ...state,
    status: 'CLUE_READING',
    clueSelectPlayerId: action.playerId,
    activeClue: {
      ...action.clue,
      failedPlayerIds: [],
    },
    buzzes: [],
  };
}

function handleBuzzerOpen(state: GameState): GameState {
  if (state.status !== 'CLUE_READING') return state;
  if (!state.activeClue) return state;

  return {
    ...state,
    status: 'BUZZ_OPEN',
  };
}

function handleBuzz(state: GameState, action: Extract<Action, { type: 'BUZZ' }>): GameState {
  if (state.status !== 'BUZZ_OPEN') return state;
  if (!state.activeClue) return state;
  if (!state.players[action.playerId]) return state;

  // One buzz per player — order is recorded, everyone types concurrently
  if (getBuzz(state, action.playerId)) return state;

  const buzzes = [...state.buzzes, { playerId: action.playerId, answer: '', locked: false }];

  // Once everyone has buzzed, the window is moot — close it
  const everyoneBuzzed = Object.keys(state.players).every(
    id => buzzes.some(b => b.playerId === id),
  );

  return {
    ...state,
    status: everyoneBuzzed ? 'ANSWERING' : 'BUZZ_OPEN',
    buzzes,
  };
}

function handleSetAnswer(state: GameState, action: Extract<Action, { type: 'SET_ANSWER' }>): GameState {
  if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING') return state;

  const buzz = getBuzz(state, action.playerId);
  if (!buzz || buzz.locked) return state;

  return {
    ...state,
    buzzes: state.buzzes.map(b =>
      b.playerId === action.playerId ? { ...b, answer: action.text } : b,
    ),
  };
}

function handleLockAnswer(state: GameState, action: Extract<Action, { type: 'LOCK_ANSWER' }>): GameState {
  if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING') return state;

  const buzz = getBuzz(state, action.playerId);
  if (!buzz || buzz.locked) return state;

  const buzzes = state.buzzes.map(b =>
    b.playerId === action.playerId
      ? { ...b, locked: true, answer: action.answer !== undefined ? action.answer : b.answer }
      : b,
  );

  // During ANSWERING (window closed) the last lock reveals early. During
  // BUZZ_OPEN others may still buzz, so TIMEOUT handles the reveal.
  const reveal = state.status === 'ANSWERING' && buzzes.every(b => b.locked);

  return {
    ...state,
    status: reveal ? 'REVEAL' : state.status,
    buzzes,
  };
}

function handleJudgeAnswer(state: GameState, action: Extract<Action, { type: 'JUDGE_ANSWER' }>): GameState {
  if (state.status !== 'REVEAL') return state;
  if (!state.activeClue) return state;
  if (action.playerId !== judgedPlayerId(state)) return state;

  const player = state.players[action.playerId];
  if (!player) return state;

  if (action.correct) {
    // Correct: award points, burn clue, winner picks next
    return {
      ...state,
      status: checkGameOver(state) ? 'GAME_OVER' : 'CHOOSE_CLUE',
      players: {
        ...state.players,
        [player.id]: { ...player, score: player.score + state.activeClue.value },
      },
      currentTurnPlayerId: player.id,
      activeClue: null,
      buzzes: [],
      clueSelectPlayerId: null,
      burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
    };
  }

  // Incorrect: deduct points, mark as failed, judge the next buzzer
  const updatedClue = {
    ...state.activeClue,
    failedPlayerIds: [...state.activeClue.failedPlayerIds, action.playerId],
  };

  const updatedPlayers = {
    ...state.players,
    [player.id]: { ...player, score: player.score - state.activeClue.value },
  };

  // Any unjudged buzzer left? If not, burn the clue — original picker keeps turn.
  const anyLeft = state.buzzes.some(b => !updatedClue.failedPlayerIds.includes(b.playerId));

  if (!anyLeft) {
    return {
      ...state,
      status: checkGameOverWith(state, updatedClue.id) ? 'GAME_OVER' : 'CHOOSE_CLUE',
      players: updatedPlayers,
      currentTurnPlayerId: state.clueSelectPlayerId,
      activeClue: null,
      buzzes: [],
      clueSelectPlayerId: null,
      burnedClueIds: [...state.burnedClueIds, updatedClue.id],
    };
  }

  // Stay in REVEAL — judgedPlayerId now selects the next buzzer in order
  return {
    ...state,
    players: updatedPlayers,
    activeClue: updatedClue,
  };
}

function handleTimeout(state: GameState): GameState {
  if (state.status !== 'BUZZ_OPEN') return state;
  if (!state.activeClue) return state;

  // Nobody buzzed: the clue lingers on screen in a "too late" state.
  // No burn or turn change yet — that happens on DISMISS_CLUE.
  if (state.buzzes.length === 0) {
    return {
      ...state,
      status: 'CLUE_EXPIRED',
    };
  }

  // Window closed. Everyone done typing → reveal; otherwise let the
  // remaining buzzers finish out their personal timers.
  return {
    ...state,
    status: allBuzzersLocked(state) ? 'REVEAL' : 'ANSWERING',
  };
}

function handleDismissClue(state: GameState): GameState {
  if (state.status !== 'CLUE_EXPIRED') return state;
  if (!state.activeClue) return state;

  // Linger is over. Burn the clue, original picker keeps turn.
  return {
    ...state,
    status: checkGameOverWith(state, state.activeClue.id) ? 'GAME_OVER' : 'CHOOSE_CLUE',
    currentTurnPlayerId: state.clueSelectPlayerId,
    activeClue: null,
    buzzes: [],
    clueSelectPlayerId: null,
    burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
  };
}

function handleSkipClue(state: GameState, action: Extract<Action, { type: 'SKIP_CLUE' }>): GameState {
  if (state.status !== 'CHOOSE_CLUE') return state;
  if (state.currentTurnPlayerId && action.playerId !== state.currentTurnPlayerId) return state;
  if (state.burnedClueIds.includes(action.clueId)) return state;

  return {
    ...state,
    status: checkGameOverWith(state, action.clueId) ? 'GAME_OVER' : 'CHOOSE_CLUE',
    burnedClueIds: [...state.burnedClueIds, action.clueId],
  };
}

function checkGameOver(state: GameState): boolean {
  // +1 because we're about to burn a clue
  return state.burnedClueIds.length + 1 >= state.totalClues;
}

function checkGameOverWith(state: GameState, clueId: number): boolean {
  if (state.burnedClueIds.includes(clueId)) return state.burnedClueIds.length >= state.totalClues;
  return state.burnedClueIds.length + 1 >= state.totalClues;
}
