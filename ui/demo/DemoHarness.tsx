import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { reducer } from '../../src/reducer';
import type { Action, GameState, GameStatus } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { LOCAL_PLAYER_ID, yourTurnFresh } from '../fixtures/gameStates';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';

// Demo loop driven by the real reducer with real Jeopardy pacing: tapping a
// cell dispatches SELECT_CLUE; the clue is "read" for 5s (buzzing locked),
// then the buzz window opens for 5s — tap the card to BUZZ. Buzzing summons
// the keyboard (ANSWER_PHASE, 10s); when time runs out the input locks and
// the keyboard drops, but the verdict is still the players' — swipe
// right/left to judge. If nobody buzzes, the clue lingers for 5s before
// burning. The harness runs the same phase timers GameServer does (the demo
// has no server); a 100ms tick keeps the countdown honest.
const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number; action: Action }>> = {
  CLUE_READING: { ms: 5000, action: { type: 'BUZZER_OPEN' } },
  BUZZ_OPEN: { ms: 5000, action: { type: 'TIMEOUT' } },
  ANSWER_PHASE: { ms: 10000, action: { type: 'LOCK_ANSWER' } },
  CLUE_EXPIRED: { ms: 5000, action: { type: 'DISMISS_CLUE' } },
};

// The info line in the clue card's bottom-left corner. Minimal during
// counting phases (just the countdown) to leave space for the space bar.
// The reading lockout shows no countdown — tracking when the buzzers open
// is part of the skill. Locked/expired states show full context text.
function statusLine(state: GameState, countdown: number | null, answer: string): string | null {
  switch (state.status) {
    case 'CLUE_READING':
      return `Wait to buzz ${PHASE_TIMERS.CLUE_READING!.ms / 1000}s`;
    case 'BUZZ_OPEN':
      return `${countdown ?? 0}s`;
    case 'ANSWER_PHASE':
      return `${countdown ?? 0}s`;
    case 'ANSWER_LOCKED': {
      const name = state.players[state.answeringPlayerId ?? '']?.name ?? 'Someone';
      return `${name} answered ${answer || 'nothing'}`;
    }
    case 'CLUE_EXPIRED':
      return 'Time to answer expired';
    default:
      return null;
  }
}

export function DemoHarness() {
  const [state, setState] = useState<GameState>(yourTurnFresh);
  const [answer, setAnswer] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const dispatch = (action: Action) => setState(s => reducer(s, action));

  useEffect(() => {
    const phase = PHASE_TIMERS[state.status];
    if (!phase) {
      setCountdown(null);
      return;
    }
    const deadline = Date.now() + phase.ms;
    setCountdown(Math.ceil(phase.ms / 1000));
    const tick = setInterval(() => {
      setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    const fire = setTimeout(() => dispatch(phase.action), phase.ms);
    return () => {
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [state.status]);

  return (
    <View style={styles.root}>
      {/* The board stays mounted underneath the clue card so it never
          re-measures: when the card unmounts, the fully drawn board is
          already there (no blank-frame flicker on the transition back). */}
      <ChooseClueScreen
        state={state}
        localPlayerId={LOCAL_PLAYER_ID}
        board={demoBoard}
        onSelectClue={clueId => {
          dispatch({
            type: 'SELECT_CLUE',
            playerId: LOCAL_PLAYER_ID,
            clue: getClueContent(clueId),
          });
        }}
      />

      {/* activeClue is non-null for exactly the four on-clue phases:
          CLUE_READING, BUZZ_OPEN, ANSWER_PHASE and CLUE_EXPIRED. */}
      {state.activeClue && (
        <View style={StyleSheet.absoluteFill}>
          <ClueScreen
            clue={state.activeClue}
            status={state.status}
            statusText={statusLine(state, countdown, answer)}
            onBuzz={() => {
              setAnswer(''); // fresh answer line on every (re-)buzz
              dispatch({ type: 'BUZZ', playerId: LOCAL_PLAYER_ID });
            }}
            onJudge={correct =>
              dispatch({ type: 'JUDGE_ANSWER', playerId: LOCAL_PLAYER_ID, correct })
            }
            answer={answer}
            onAnswerChange={setAnswer}
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
