import type { GameState, Action, Player } from './types.js';

export function createInitialState(playerNames: string[]): GameState {
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
    answeringPlayerId: null,
    burnedClueIds: [],
    totalClues: 30,
  };
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SELECT_CLUE':
      return handleSelectClue(state, action);
    case 'BUZZ':
      return handleBuzz(state, action);
    case 'JUDGE_ANSWER':
      return handleJudgeAnswer(state, action);
    case 'TIMEOUT':
      return handleTimeout(state);
    case 'BUZZER_OPEN':
      return handleBuzzerOpen(state);
    case 'DISMISS_CLUE':
      return handleDismissClue(state);
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
    answeringPlayerId: null,
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

  // Can't buzz if you already failed this clue
  if (state.activeClue.failedPlayerIds.includes(action.playerId)) return state;

  return {
    ...state,
    status: 'ANSWER_PHASE',
    answeringPlayerId: action.playerId,
  };
}

function handleJudgeAnswer(state: GameState, action: Extract<Action, { type: 'JUDGE_ANSWER' }>): GameState {
  if (state.status !== 'ANSWER_PHASE') return state;
  if (!state.activeClue) return state;
  if (state.answeringPlayerId !== action.playerId) return state;

  const player = state.players[action.playerId];
  if (!player) return state;

  if (action.correct) {
    // Correct: award points, burn clue, answerer picks next
    return {
      ...state,
      status: checkGameOver(state) ? 'GAME_OVER' : 'CHOOSE_CLUE',
      players: {
        ...state.players,
        [player.id]: { ...player, score: player.score + state.activeClue.value },
      },
      currentTurnPlayerId: player.id,
      activeClue: null,
      answeringPlayerId: null,
      clueSelectPlayerId: null,
      burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
    };
  } else {
    // Incorrect: deduct points, mark as failed, back to CLUE_READING
    const updatedClue = {
      ...state.activeClue,
      failedPlayerIds: [...state.activeClue.failedPlayerIds, action.playerId],
    };

    const updatedPlayers = {
      ...state.players,
      [player.id]: { ...player, score: player.score - state.activeClue.value },
    };

    // Check if all players have failed — if so, burn the clue
    const allPlayerIds = Object.keys(state.players);
    const allFailed = allPlayerIds.every(id => updatedClue.failedPlayerIds.includes(id));

    if (allFailed) {
      return {
        ...state,
        status: checkGameOverWith(state, updatedClue.id) ? 'GAME_OVER' : 'CHOOSE_CLUE',
        players: updatedPlayers,
        currentTurnPlayerId: state.clueSelectPlayerId,
        activeClue: null,
        answeringPlayerId: null,
        clueSelectPlayerId: null,
        burnedClueIds: [...state.burnedClueIds, updatedClue.id],
      };
    }

    // Others can still buzz — the window reopens right away (no re-reading)
    return {
      ...state,
      status: 'BUZZ_OPEN',
      players: updatedPlayers,
      activeClue: updatedClue,
      answeringPlayerId: null,
    };
  }
}

function handleTimeout(state: GameState): GameState {
  if (state.status !== 'BUZZ_OPEN') return state;
  if (!state.activeClue) return state;

  // Nobody buzzed: the clue lingers on screen in a "too late" state.
  // No burn or turn change yet — that happens on DISMISS_CLUE.
  return {
    ...state,
    status: 'CLUE_EXPIRED',
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
    answeringPlayerId: null,
    clueSelectPlayerId: null,
    burnedClueIds: [...state.burnedClueIds, state.activeClue.id],
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
