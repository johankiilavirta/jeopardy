import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getBuzz, judgedPlayerId, reducer } from '../../src/reducer';
import type { Action, GameState, GameStatus } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { LOCAL_PLAYER_ID, yourTurnFresh } from '../fixtures/gameStates';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';

// Demo loop driven by the real reducer with real Jeopardy pacing: tapping a
// cell dispatches SELECT_CLUE; the clue is "read" for 5s (buzzing locked),
// then the buzz window opens for 5s — tap the card to BUZZ. Buzzing summons
// the keyboard and starts your personal 10s typing timer; swipe the keyboard
// down to lock your answer in early (or the timer locks it for you). Once
// everyone who buzzed is locked and the window is closed, the correct answer
// is revealed — swipe right/left to judge the answer on the stand. If nobody
// buzzes, the clue lingers for 5s before burning. The harness runs the same
// timers GameServer does (the demo has no server); a 100ms tick keeps the
// countdowns honest.
const PHASE_TIMERS: Partial<Record<GameStatus, { ms: number; action: Action }>> = {
  CLUE_READING: { ms: 5000, action: { type: 'BUZZER_OPEN' } },
  BUZZ_OPEN: { ms: 5000, action: { type: 'TIMEOUT' } },
  CLUE_EXPIRED: { ms: 5000, action: { type: 'DISMISS_CLUE' } },
};

/** Personal typing time, from each player's own buzz (mirrors answerMs). */
const ANSWER_MS = 10000;

// The info line in the clue card's bottom-left corner. Minimal during
// counting phases (just the countdown) to leave space for the space bar.
// The reading lockout shows no countdown — tracking when the buzzers open
// is part of the skill. The personal typing countdown wins over the window
// countdown while the local player is typing.
function statusLine(
  state: GameState,
  countdown: number | null,
  personalCountdown: number | null,
): string | null {
  switch (state.status) {
    case 'CLUE_READING':
      return `Wait to buzz ${PHASE_TIMERS.CLUE_READING!.ms / 1000}s`;
    case 'BUZZ_OPEN':
    case 'ANSWERING':
      return `${(personalCountdown ?? countdown) ?? 0}s`;
    case 'REVEAL': {
      const onStand = judgedPlayerId(state);
      const name = state.players[onStand ?? '']?.name ?? 'Someone';
      const text = onStand ? getBuzz(state, onStand)?.answer : '';
      return `${name} ANSWERED ${text ? `"${text}"` : 'NOTHING'}`.toUpperCase();
    }
    case 'CLUE_EXPIRED':
      return 'Time to answer expired';
    default:
      return null;
  }
}

export function DemoHarness() {
  const [state, setState] = useState<GameState>(yourTurnFresh);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [personalCountdown, setPersonalCountdown] = useState<number | null>(null);
  const dispatch = (action: Action) => setState(s => reducer(s, action));

  const localBuzz = getBuzz(state, LOCAL_PLAYER_ID);
  // Buzzed and still typing — the keyboard is up and the personal timer runs.
  const typing =
    !!localBuzz &&
    !localBuzz.locked &&
    (state.status === 'BUZZ_OPEN' || state.status === 'ANSWERING');

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

  // Personal typing timer: 10s from the local player's own buzz, surviving
  // the BUZZ_OPEN → ANSWERING transition untouched (`typing` stays true).
  // Locks the answer as-is when it runs out; swipe-down locks earlier and
  // tears this down via the cleanup.
  useEffect(() => {
    if (!typing) {
      setPersonalCountdown(null);
      return;
    }
    const deadline = Date.now() + ANSWER_MS;
    setPersonalCountdown(Math.ceil(ANSWER_MS / 1000));
    const tick = setInterval(() => {
      setPersonalCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    const fire = setTimeout(
      () => dispatch({ type: 'LOCK_ANSWER', playerId: LOCAL_PLAYER_ID }),
      ANSWER_MS,
    );
    return () => {
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [typing]);

  // Single-device demo: whoever's answer is on the stand gets judged.
  const onStand = judgedPlayerId(state);

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

      {/* activeClue is non-null for exactly the on-clue phases:
          CLUE_READING, BUZZ_OPEN, ANSWERING, REVEAL and CLUE_EXPIRED. */}
      {state.activeClue && (
        <View style={StyleSheet.absoluteFill}>
          <ClueScreen
            clue={state.activeClue}
            statusText={statusLine(state, countdown, typing ? personalCountdown : null)}
            canBuzz={state.status === 'BUZZ_OPEN' && !localBuzz}
            showKeyboard={typing}
            canJudge={state.status === 'REVEAL'}
            onBuzz={() => dispatch({ type: 'BUZZ', playerId: LOCAL_PLAYER_ID })}
            onJudge={correct => {
              if (onStand) dispatch({ type: 'JUDGE_ANSWER', playerId: onStand, correct });
            }}
            answer={localBuzz?.answer ?? ''}
            onAnswerChange={text =>
              dispatch({ type: 'SET_ANSWER', playerId: LOCAL_PLAYER_ID, text })
            }
            onLockAnswer={text =>
              dispatch({ type: 'LOCK_ANSWER', playerId: LOCAL_PLAYER_ID, answer: text })
            }
            reveal={
              state.status === 'REVEAL'
                ? { correctAnswer: state.activeClue.answer }
                : undefined
            }
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
