import type { GameState, Action, Buzz, Player } from './types.js';

export function createInitialState(playerNames: string[], totalClues = 30, finalClue?: { category: string; text: string; answer: string } | null): GameState {
  const players: Record<string, Player> = {};
  for (const name of playerNames) {
    let id = name.trim().toLowerCase().replace(/\s+/g, '-') || 'player';
    let suffix = '';
    let counter = 1;
    while (players[id + suffix]) {
      counter++;
      suffix = `-${counter}`;
    }
    const finalId = id + suffix;
    const finalName = name.trim() ? (counter === 1 ? name : `${name} ${counter}`) : `Player ${Math.floor(Math.random() * 1000)}`;
    players[finalId] = { id: finalId, name: finalName, score: 0, correct: 0, incorrect: 0, scoreHistory: [0] };
  }
  return {
    status: 'CHOOSE_CLUE',
    players,
    currentTurnPlayerId: null, // anyone can pick first
    clueSelectPlayerId: null,
    activeClue: null,
    buzzes: [],
    passedPlayerIds: [],
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
    passedPlayerIds: [],
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
    case 'PASS_CLUE':
      return handlePassClue(state, action);
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
    passedPlayerIds: [],
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

  // Opening the answer keyboard is a stronger, newer signal than passing:
  // withdraw this player's pass and let them answer normally.
  const passedPlayerIds = (state.passedPlayerIds ?? []).filter(
    id => id !== action.playerId,
  );
  const buzzes = [...state.buzzes, { playerId: action.playerId, answer: '', locked: false }];

  // Once everyone has buzzed, the window is moot — close it
  const activePlayers = Object.keys(state.players).filter(id => id !== 'opponent');
  const everyoneActed = activePlayers.every(
    id => passedPlayerIds.includes(id) || buzzes.some(b => b.playerId === id),
  );

  return {
    ...state,
    status: everyoneActed ? 'ANSWERING' : 'BUZZ_OPEN',
    buzzes,
    passedPlayerIds,
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
  const allBuzzersNowLocked = buzzes.every(b => b.locked);
  const reveal = (state.status === 'ANSWERING' || state.status === 'FINAL_JEOPARDY_WAGER' || state.status === 'FINAL_JEOPARDY_ANSWER' || isSolo) && allBuzzersNowLocked;

  // A locked answer counts as this player's response to the clue. If any
  // other player passed, resolve as a shared skip once everybody has acted:
  // show the correct answer, award no points, and return to the board after
  // the short expired-clue linger.
  const passed = state.passedPlayerIds ?? [];
  if (passed.length > 0 && allBuzzersNowLocked) {
    const allActed = activePlayers.every(
      id => passed.includes(id) || buzzes.some(b => b.playerId === id && b.locked),
    );
    if (allActed) {
      return { ...state, status: 'CLUE_EXPIRED', buzzes };
    }
  }

  if (reveal && state.status === 'FINAL_JEOPARDY_WAGER') {
    const finalWagers: Record<string, number> = {};
    for (const b of buzzes) {
      // A wager can't exceed what the player has (nor go below zero) —
      // anything typed over the line rounds down to their score.
      const wager = parseInt(b.answer || '0', 10);
      const maxWager = Math.max(0, state.players[b.playerId]?.score ?? 0);
      finalWagers[b.playerId] = Math.min(Number.isFinite(wager) ? Math.max(0, wager) : 0, maxWager);
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

  const player = state.players[action.playerId];
  if (!player) return state;

  // Final Jeopardy: every answer is on the stand at once and may be judged
  // in any order. Each verdict settles that player's wager and retires
  // their buzz; the last verdict ends the game. Score history gets one
  // point for the whole round, pushed when the final verdict lands.
  if (state.activeClue.id === -1) {
    if (!getBuzz(state, action.playerId)) return state;
    const finalWager = state.finalWagers?.[player.id] ?? 0;
    const delta = action.correct ? finalWager : action.penalty !== false ? -finalWager : 0;
    const buzzes = state.buzzes.filter(b => b.playerId !== action.playerId);
    const done = buzzes.length === 0;
    const updatedPlayers: Record<string, Player> = {};
    for (const p of Object.values(state.players)) {
      const judged =
        p.id !== player.id
          ? p
          : {
              ...p,
              score: p.score + delta,
              correct: p.correct + (action.correct ? 1 : 0),
              incorrect: p.incorrect + (action.correct ? 0 : 1),
            };
      updatedPlayers[p.id] = done
        ? { ...judged, scoreHistory: [...judged.scoreHistory, judged.score] }
        : judged;
    }
    if (!done) return { ...state, buzzes, players: updatedPlayers };
    return {
      ...state,
      status: 'GAME_OVER',
      activeClue: null,
      buzzes: [],
      clueSelectPlayerId: null,
      currentTurnPlayerId: null,
      players: updatedPlayers,
    };
  }

  if (action.playerId !== judgedPlayerId(state)) return state;

  const wager = state.activeClue.value;

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
    return {
      ...state,
      ...transitionFromBoard(state, undefined),
      players: updatedPlayers,
      currentTurnPlayerId: player.id,
      burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
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
    return {
      ...state,
      ...transitionFromBoard(state, updatedClue.id),
      players: updatedPlayers,
      currentTurnPlayerId: state.clueSelectPlayerId,
      burnedClueIds: [...state.burnedClueIds, updatedClue.id],
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

  // A pass means no further player can change the outcome once the buzz
  // window closes. Show the correct answer without judging.
  if ((state.passedPlayerIds?.length ?? 0) > 0) {
    return {
      ...state,
      status: 'CLUE_EXPIRED',
    };
  }

  // Window closed. Everyone done typing → reveal; otherwise let the
  // remaining buzzers reach that same window's answer deadline.
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

  // Final Jeopardy can't be skipped — re-burning would loop back into it.
  if (state.activeClue?.id === -1) return state;

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

/** Record one player's pull-down pass. The gesture is intentionally distinct
 *  from SKIP_CLUE, the host-only testing tool that burns a board cell. */
function handlePassClue(state: GameState, action: Extract<Action, { type: 'PASS_CLUE' }>): GameState {
  if (
    state.status !== 'CLUE_READING' &&
    state.status !== 'BUZZ_OPEN' &&
    state.status !== 'ANSWERING'
  ) return state;
  if (!state.activeClue || state.activeClue.id === -1) return state;
  if (!state.players[action.playerId]) return state;

  const passed = state.passedPlayerIds ?? [];
  if (passed.includes(action.playerId)) return state;

  const existingBuzz = getBuzz(state, action.playerId);
  // Once an answer is locked it is final and counts as the player's action;
  // it cannot be replaced with a pass afterward.
  if (existingBuzz?.locked) return state;

  const nextPassed = [...passed, action.playerId];
  // A player can dismiss an empty keyboard and then pull down again to pass.
  // Remove that unlocked blank buzz so its answer timer cannot fire later.
  const buzzes = state.buzzes.filter(b => b.playerId !== action.playerId);
  const activePlayers = Object.keys(state.players).filter(id => id !== 'opponent');
  const allActed = activePlayers.every(
    id => nextPassed.includes(id) || buzzes.some(b => b.playerId === id && b.locked),
  );

  return {
    ...state,
    status: allActed ? 'CLUE_EXPIRED' : state.status,
    buzzes,
    passedPlayerIds: nextPassed,
  };
}

function transitionFromBoard(state: GameState, burningClueId?: number): Partial<GameState> {
  const isOver = burningClueId !== undefined 
    ? (state.burnedClueIds.includes(burningClueId) ? state.burnedClueIds.length >= state.totalClues : state.burnedClueIds.length + 1 >= state.totalClues)
    : state.burnedClueIds.length + 1 >= state.totalClues;

  if (!isOver) {
    return { status: 'CHOOSE_CLUE', activeClue: null, buzzes: [], clueSelectPlayerId: null, passedPlayerIds: [] };
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
    return { status: 'FINAL_JEOPARDY_WAGER', activeClue: wagerClue, buzzes, clueSelectPlayerId: null, passedPlayerIds: [] };
  }
  
  return { status: 'GAME_OVER', activeClue: null, buzzes: [], clueSelectPlayerId: null, passedPlayerIds: [] };
}
