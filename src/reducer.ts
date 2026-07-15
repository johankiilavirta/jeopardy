import type { GameState, Action, Buzz, Player } from './types.js';

export function createInitialState(playerNames: string[], totalClues = 30, finalClue?: { category: string; text: string; answer: string } | null): GameState {
  const players: Record<string, Player> = {};
  for (const name of playerNames) {
    const id = name.toLowerCase().replace(/\s+/g, '-');
    players[id] = { id, name, score: 0, correct: 0, incorrect: 0, scoreHistory: [0] };
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
    finalClue: finalClue ?? null,
  };
}

/** Prepare a saved state for resuming in a fresh server: any in-flight clue
 *  is abandoned (unburned, so it can be picked again) and buzzes are
 *  discarded — the game resumes at the board. Scores, burned clues, and
 *  whose turn it is all carry over. */
export function normalizeForResume(state: GameState): GameState {
  if (state.status === 'CHOOSE_CLUE') return state;
  return {
    ...state,
    status: 'CHOOSE_CLUE',
    activeClue: null,
    buzzes: [],
    clueSelectPlayerId: null,
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
    case 'UNLOCK_ANSWER':
      return handleUnlockAnswer(state, action);
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
  const activePlayers = Object.keys(state.players).filter(id => id !== 'opponent');
  const everyoneBuzzed = activePlayers.every(
    id => buzzes.some(b => b.playerId === id),
  );

  return {
    ...state,
    status: everyoneBuzzed ? 'ANSWERING' : 'BUZZ_OPEN',
    buzzes,
  };
}

function handleSetAnswer(state: GameState, action: Extract<Action, { type: 'SET_ANSWER' }>): GameState {
  if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING' && state.status !== 'FINAL_JEOPARDY_WAGER' && state.status !== 'FINAL_JEOPARDY_ANSWER') return state;

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
  if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING' && state.status !== 'FINAL_JEOPARDY_WAGER' && state.status !== 'FINAL_JEOPARDY_ANSWER') return state;

  const buzz = getBuzz(state, action.playerId);
  if (!buzz || buzz.locked) return state;

  const buzzes = state.buzzes.map(b =>
    b.playerId === action.playerId
      ? { ...b, locked: true, answer: action.answer !== undefined ? action.answer : b.answer }
      : b,
  );

  // During ANSWERING (window closed) the last lock reveals early. During
  // BUZZ_OPEN others may still buzz, so TIMEOUT handles the reveal.
  // In solo mode (only 1 active player in the game), we reveal immediately when they lock.
  const activePlayers = Object.keys(state.players).filter(id => id !== 'opponent');
  const isSolo = activePlayers.length === 1;
  const reveal = (state.status === 'ANSWERING' || state.status === 'FINAL_JEOPARDY_WAGER' || state.status === 'FINAL_JEOPARDY_ANSWER' || isSolo) && buzzes.every(b => b.locked);

  if (reveal && state.status === 'FINAL_JEOPARDY_WAGER') {
    const finalWagers: Record<string, number> = {};
    for (const b of buzzes) {
      finalWagers[b.playerId] = parseInt(b.answer || '0', 10);
    }
    const nextBuzzes = activePlayers.map(id => ({ playerId: id, answer: '', locked: false }));
    return {
      ...state,
      status: 'FINAL_JEOPARDY_ANSWER',
      activeClue: {
        ...state.activeClue!,
        category: state.finalClue!.category,
        text: state.finalClue!.text,
      },
      finalWagers,
      buzzes: nextBuzzes,
    };
  }

  if (reveal && state.status === 'FINAL_JEOPARDY_ANSWER') {
    return {
      ...state,
      status: 'REVEAL',
      buzzes,
    };
  }

  return {
    ...state,
    status: reveal ? 'REVEAL' : state.status,
    buzzes,
  };
}

function handleUnlockAnswer(state: GameState, action: Extract<Action, { type: 'UNLOCK_ANSWER' }>): GameState {
  if (state.status !== 'BUZZ_OPEN' && state.status !== 'ANSWERING' && state.status !== 'FINAL_JEOPARDY_WAGER' && state.status !== 'FINAL_JEOPARDY_ANSWER') return state;

  const buzz = getBuzz(state, action.playerId);
  if (!buzz || !buzz.locked) return state;

  const buzzes = state.buzzes.map(b =>
    b.playerId === action.playerId ? { ...b, locked: false } : b
  );

  return {
    ...state,
    buzzes,
  };
}

function handleJudgeAnswer(state: GameState, action: Extract<Action, { type: 'JUDGE_ANSWER' }>): GameState {
  if (state.status !== 'REVEAL') return state;
  if (!state.activeClue) return state;
  if (action.playerId !== judgedPlayerId(state)) return state;

  const player = state.players[action.playerId];
  if (!player) return state;

  const wager = state.finalWagers?.[player.id] ?? state.activeClue.value;

  if (action.correct) {
    // Correct: award points, burn clue, winner picks next
    const newScore = player.score + wager;
    const updatedPlayers: Record<string, Player> = {};
    for (const p of Object.values(state.players)) {
      if (p.id === player.id) {
        updatedPlayers[p.id] = {
          ...p,
          score: newScore,
          correct: p.correct + 1,
          scoreHistory: [...p.scoreHistory, newScore],
        };
      } else {
        updatedPlayers[p.id] = {
          ...p,
          scoreHistory: [...p.scoreHistory, p.score],
        };
      }
    }
    const isFinal = state.activeClue.id === -1;
    return {
      ...state,
      ...(isFinal ? { status: 'GAME_OVER', activeClue: null, buzzes: [], clueSelectPlayerId: null } : transitionFromBoard(state, undefined)),
      players: updatedPlayers,
      currentTurnPlayerId: player.id,
      burnedClueIds: isFinal ? state.burnedClueIds : [...state.burnedClueIds, state.activeClue.id],
    };
  }

  // Incorrect: deduct points, mark as failed, judge the next buzzer
  const updatedClue = {
    ...state.activeClue,
    failedPlayerIds: [...state.activeClue.failedPlayerIds, action.playerId],
  };

  const scoreChange = action.penalty !== false ? -wager : 0;
  const judgedNewScore = player.score + scoreChange;

  // Any unjudged buzzer left? If not, burn the clue — original picker keeps turn.
  const anyLeft = state.buzzes.some(b => !updatedClue.failedPlayerIds.includes(b.playerId));

  if (!anyLeft) {
    // All buzzers exhausted — burn clue, push scoreHistory for everyone
    const updatedPlayers: Record<string, Player> = {};
    for (const p of Object.values(state.players)) {
      if (p.id === player.id) {
        updatedPlayers[p.id] = {
          ...p,
          score: judgedNewScore,
          incorrect: p.incorrect + 1,
          scoreHistory: [...p.scoreHistory, judgedNewScore],
        };
      } else {
        updatedPlayers[p.id] = {
          ...p,
          scoreHistory: [...p.scoreHistory, p.score],
        };
      }
    }
    const isFinal = updatedClue.id === -1;
    return {
      ...state,
      ...(isFinal ? { status: 'GAME_OVER', activeClue: null, buzzes: [], clueSelectPlayerId: null } : transitionFromBoard(state, updatedClue.id)),
      players: updatedPlayers,
      currentTurnPlayerId: state.clueSelectPlayerId,
      burnedClueIds: isFinal ? state.burnedClueIds : [...state.burnedClueIds, updatedClue.id],
    };
  }

  // Stay in REVEAL — judgedPlayerId now selects the next buzzer in order.
  // Increment incorrect for the judged player only — clue isn't burned yet, no history point.
  const updatedPlayers = {
    ...state.players,
    [player.id]: {
      ...player,
      score: judgedNewScore,
      incorrect: player.incorrect + 1,
    },
  };
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
  // Push current scores to scoreHistory for the flat segment (no score change).
  const updatedPlayers: Record<string, Player> = {};
  for (const p of Object.values(state.players)) {
    updatedPlayers[p.id] = {
      ...p,
      scoreHistory: [...p.scoreHistory, p.score],
    };
  }
  return {
    ...state,
    ...transitionFromBoard(state, state.activeClue.id),
    players: updatedPlayers,
    currentTurnPlayerId: state.clueSelectPlayerId,
    burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
  };
}

// Testing/host tool: burn a clue without playing it. Works from the board
// (CHOOSE_CLUE) or while a clue is up (CLUE_READING). No turn enforcement —
// either player may skip any clue. The burn is server-authoritative, so the
// clue grays out for both players.
function handleSkipClue(state: GameState, action: Extract<Action, { type: 'SKIP_CLUE' }>): GameState {
  if (state.status === 'GAME_OVER') return state;

  // If a clue is currently up, skip that one regardless of the id sent.
  const skippingActive = state.activeClue != null;
  const clueId = skippingActive ? state.activeClue!.id : action.clueId;

  if (state.burnedClueIds.includes(clueId)) return state;

  return {
    ...state,
    ...transitionFromBoard(state, clueId),
    currentTurnPlayerId: skippingActive ? state.clueSelectPlayerId : state.currentTurnPlayerId,
    burnedClueIds: [...state.burnedClueIds, clueId],
  };
}

function transitionFromBoard(state: GameState, burningClueId?: number): Partial<GameState> {
  const isOver = burningClueId !== undefined 
    ? (state.burnedClueIds.includes(burningClueId) ? state.burnedClueIds.length >= state.totalClues : state.burnedClueIds.length + 1 >= state.totalClues)
    : state.burnedClueIds.length + 1 >= state.totalClues;

  if (!isOver) {
    return { status: 'CHOOSE_CLUE', activeClue: null, buzzes: [], clueSelectPlayerId: null };
  }
  
  if (state.finalClue) {
    const activePlayers = Object.keys(state.players).filter(id => id !== 'opponent');
    const buzzes = activePlayers.map(id => ({ playerId: id, answer: '', locked: false }));
    const wagerClue = {
      id: -1,
      category: 'FINAL JEOPARDY',
      text: state.finalClue.category,
      answer: state.finalClue.answer,
      value: 0,
      failedPlayerIds: [],
    };
    return { status: 'FINAL_JEOPARDY_WAGER', activeClue: wagerClue, buzzes, clueSelectPlayerId: null };
  }
  
  return { status: 'GAME_OVER', activeClue: null, buzzes: [], clueSelectPlayerId: null };
}
