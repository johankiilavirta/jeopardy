import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { reducer } from '../../src/reducer';
import type { Action, GameState } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { LOCAL_PLAYER_ID, yourTurnFresh } from '../fixtures/gameStates';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';

// Demo loop driven by the real reducer: tapping a cell dispatches SELECT_CLUE
// (board → clue card); swiping the card right/left dispatches BUZZ +
// JUDGE_ANSWER (correct/incorrect — scores update for real); tapping it
// dispatches TIMEOUT (pass: burns the clue, back to the board). Other
// fixtures live in ui/fixtures/gameStates.ts — swap the initial state below
// to preview them.
export function DemoHarness() {
  const [state, setState] = useState<GameState>(yourTurnFresh);
  const dispatch = (action: Action) => setState(s => reducer(s, action));

  return (
    <View style={styles.root}>
      {/* The board stays mounted underneath the clue card so it never
          re-measures: when the card unmounts, the fully drawn board is
          already there (no blank-frame flicker on the transition back). */}
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

      {state.status === 'CLUE_READING' && state.activeClue && (
        <View style={StyleSheet.absoluteFill}>
          <ClueScreen
            clue={state.activeClue}
            onContinue={() => dispatch({ type: 'TIMEOUT' })}
            onJudge={correct => {
              dispatch({ type: 'BUZZ', playerId: LOCAL_PLAYER_ID });
              dispatch({ type: 'JUDGE_ANSWER', playerId: LOCAL_PLAYER_ID, correct });
              // The reducer auto-returns to the board once ALL players have
              // missed. The demo opponent never buzzes, so on a miss we time
              // the clue out right away — exactly what the real 5s buzzer
              // timer does in multiplayer when nobody else buzzes in.
              if (!correct) dispatch({ type: 'TIMEOUT' });
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
