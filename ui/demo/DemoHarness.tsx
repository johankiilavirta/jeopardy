import { useState } from 'react';
import { reducer } from '../../src/reducer';
import type { Action, GameState } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { LOCAL_PLAYER_ID, yourTurnFresh } from '../fixtures/gameStates';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';

// Demo loop driven by the real reducer: tapping a cell dispatches SELECT_CLUE
// (board → clue card), tapping the card dispatches TIMEOUT (burns the clue,
// back to the board). Other fixtures live in ui/fixtures/gameStates.ts —
// swap the initial state below to preview them.
export function DemoHarness() {
  const [state, setState] = useState<GameState>(yourTurnFresh);
  const dispatch = (action: Action) => setState(s => reducer(s, action));

  if (state.status === 'CLUE_READING' && state.activeClue) {
    return (
      <ClueScreen clue={state.activeClue} onContinue={() => dispatch({ type: 'TIMEOUT' })} />
    );
  }

  return (
    <ChooseClueScreen
      state={state}
      localPlayerId={LOCAL_PLAYER_ID}
      board={demoBoard}
      onSelectClue={clueId =>
        dispatch({
          type: 'SELECT_CLUE',
          playerId: LOCAL_PLAYER_ID,
          clue: getClueContent(clueId),
        })
      }
    />
  );
}
