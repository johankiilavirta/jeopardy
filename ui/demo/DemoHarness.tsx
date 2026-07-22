import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getBuzz, judgedPlayerId, reducer } from '../../src/reducer';
import { computeReadingMs } from '../../src/readingTime';
import type { Action, GameState, GameStatus } from '../../src/types';
import { demoBoard } from '../fixtures/board';
import { getClueContent } from '../fixtures/clues';
import { LOCAL_PLAYER_ID, yourTurnFresh } from '../fixtures/gameStates';
import { ChooseClueScreen } from '../screens/ChooseClueScreen';
import { ClueScreen } from '../screens/ClueScreen';
import { PLAYER_BAR_HEIGHT } from '../components/PlayerHeader';
import { JudgementTray } from '../components/JudgementTray';
import { ExpandingClueOverlay } from '../components/ExpandingClueOverlay';
import type { CellRect } from '../components/BoardCell';

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
  BUZZ_OPEN: { ms: 20000, action: { type: 'TIMEOUT' } },
  CLUE_EXPIRED: { ms: 5000, action: { type: 'DISMISS_CLUE' } },
};

/** Final Jeopardy gives each player a fresh 30-second window for both the
 *  wager and answer phases (mirrors NetworkedGame). */
const FINAL_ANSWER_MS = 30000;

type DemoScreen = 'board' | 'clue' | 'long-clue' | 'judge' | 'final-wager';

function initialStateFor(screen: string | undefined): GameState {
  const clue = getClueContent(0);
  switch (screen) {
    case 'clue':
      return {
        ...yourTurnFresh,
        status: 'CLUE_READING',
        clueSelectPlayerId: LOCAL_PLAYER_ID,
        activeClue: { ...clue, failedPlayerIds: [] },
      };
    case 'long-clue':
      return {
        ...yourTurnFresh,
        status: 'CLUE_READING',
        clueSelectPlayerId: LOCAL_PLAYER_ID,
        activeClue: {
          ...clue,
          category: 'INQUISITIVE WRITERS',
          text: 'IN A LETTER WRITTEN AFTER HIS FIRST VOYAGE, THIS EXPLORER DESCRIBED ISLANDS WITH MOUNTAINS OF GREAT HEIGHT, FERTILE VALLEYS, MANY HARBORS, AND PEOPLE WHO TRAVELED BETWEEN THEM IN LARGE CANOES; HE ALSO CLAIMED THE LAND HELD SPICES, GOLD, AND OTHER RICHES, THAT ITS PEOPLE COULD BE CONVERTED BY LOVE RATHER THAN FORCE, AND THAT THEIR RULERS WOULD WELCOME TRADE WITH HIS SOVEREIGNS, A DELIBERATELY OVERSIZED CLUE WITH ENOUGH EXTRA DETAIL TO OVERFLOW IN LANDSCAPE AND SHRINK ONLY ENOUGH TO LEAVE ROOM FOR THE ANSWER BELOW',
          answer: 'CHRISTOPHER COLUMBUS',
          failedPlayerIds: [],
        },
      };
    case 'judge':
      return {
        ...yourTurnFresh,
        status: 'REVEAL',
        clueSelectPlayerId: LOCAL_PLAYER_ID,
        activeClue: { ...clue, failedPlayerIds: [] },
        // Both players buzzed, so judging the first answer wrong hands the
        // stand (and the bottom highlight) to the second buzzer.
        buzzes: [
          { playerId: LOCAL_PLAYER_ID, answer: 'MEZCAL', locked: true },
          { playerId: 'opponent', answer: 'TEQUILA', locked: true },
        ],
      };
    case 'final-wager':
      return {
        ...yourTurnFresh,
        status: 'FINAL_JEOPARDY_WAGER',
        currentTurnPlayerId: null,
        activeClue: {
          id: -1,
          category: 'FINAL JEOPARDY',
          text: 'ACRONYMS',
          answer: 'NASA',
          value: 0,
          failedPlayerIds: [],
        },
        buzzes: [
          { playerId: LOCAL_PLAYER_ID, answer: '', locked: false },
          { playerId: 'opponent', answer: '', locked: false },
        ],
      };
    default:
      return yourTurnFresh;
  }
}


export function DemoHarness({ initialScreen }: { initialScreen?: string } = {}) {
  const [state, setState] = useState<GameState>(() => initialStateFor(initialScreen));
  const selectedCellRef = useRef<{ clueId: number; rect: CellRect } | null>(null);
  // Deadlines (epoch ms) for the current phase window and the local player's
  // shared answer window — they drive the activation lights' drain.
  const [phaseDeadline, setPhaseDeadline] = useState<number | null>(null);
  // Persists through BUZZ_OPEN → ANSWERING so post-buzz lights share the deadline.
  const buzzWindowDeadlineRef = useRef<number | null>(null);
  const dispatch = (action: Action) => setState(s => reducer(s, action));

  const localBuzz = getBuzz(state, LOCAL_PLAYER_ID);
  const localPassed = (state.passedPlayerIds ?? []).includes(LOCAL_PLAYER_ID);
  // Buzzed and still typing — the keyboard is up until the shared deadline.
  const typing =
    !!localBuzz &&
    !localBuzz.locked &&
    (state.status === 'BUZZ_OPEN' ||
      state.status === 'ANSWERING' ||
      state.status === 'FINAL_JEOPARDY_WAGER' ||
      state.status === 'FINAL_JEOPARDY_ANSWER');

  useEffect(() => {
    if (
      state.status === 'FINAL_JEOPARDY_WAGER' ||
      state.status === 'FINAL_JEOPARDY_ANSWER'
    ) {
      const deadline = Date.now() + FINAL_ANSWER_MS;
      setPhaseDeadline(deadline);
      buzzWindowDeadlineRef.current = deadline;
      return;
    }

    const phase = PHASE_TIMERS[state.status];
    if (!phase) {
      setPhaseDeadline(null);
      return;
    }
    const ms = state.status === 'CLUE_READING' && state.activeClue
      ? computeReadingMs(state.activeClue.text)
      : state.status === 'CLUE_EXPIRED' && (state.passedPlayerIds?.length ?? 0) > 0
        ? 3000
        : phase.ms;
    const deadline = Date.now() + ms;
    setPhaseDeadline(deadline);
    if (state.status === 'BUZZ_OPEN') buzzWindowDeadlineRef.current = deadline;
    const fire = setTimeout(() => dispatch(phase.action), ms);
    return () => clearTimeout(fire);
  }, [state.status]);

  // Lock the answer when the buzz window expires — buzzing never resets it.
  // Swipe-down locks earlier and tears this down via the cleanup.
  useEffect(() => {
    if (!typing) return;
    const remaining = Math.max(50, (buzzWindowDeadlineRef.current ?? 0) - Date.now());
    const fire = setTimeout(
      () => dispatch({ type: 'LOCK_ANSWER', playerId: LOCAL_PLAYER_ID }),
      remaining,
    );
    return () => clearTimeout(fire);
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
        judgingPlayerId={state.status === 'REVEAL' ? onStand : null}
        onSelectClue={(clueId, rect) => {
          selectedCellRef.current = { clueId, rect };
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
        <ExpandingClueOverlay
          key={state.activeClue.id}
          fromRect={
            selectedCellRef.current?.clueId === state.activeClue.id
              ? selectedCellRef.current.rect
              : null
          }
          animate={true}
          bottomInset={PLAYER_BAR_HEIGHT}
        >
          <ClueScreen
            clue={state.activeClue}
            isFinalJeopardyWager={state.status === 'FINAL_JEOPARDY_WAGER'}
            canBuzz={state.status === 'BUZZ_OPEN' && !localBuzz}
            canPass={
              state.activeClue.id !== -1 &&
              !localPassed &&
              !localBuzz?.locked &&
              (
                state.status === 'CLUE_READING' ||
                state.status === 'BUZZ_OPEN' ||
                state.status === 'ANSWERING'
              )
            }
            onPass={() => dispatch({ type: 'PASS_CLUE', playerId: LOCAL_PLAYER_ID })}
            lights={
              (state.status === 'BUZZ_OPEN' || state.status === 'ANSWERING') &&
              buzzWindowDeadlineRef.current != null
                ? { deadline: buzzWindowDeadlineRef.current, durationMs: PHASE_TIMERS.BUZZ_OPEN!.ms, flash: true }
                : null
            }
            showKeyboard={typing}
            keyboardType={state.status === 'FINAL_JEOPARDY_WAGER' ? 'number' : 'text'}
            inputPrefix={state.status === 'FINAL_JEOPARDY_WAGER' ? '$' : ''}
            placeholder={state.status === 'FINAL_JEOPARDY_WAGER' ? 'ENTER WAGER' : 'TYPE YOUR ANSWER'}
            onMaxWager={
              state.status === 'FINAL_JEOPARDY_WAGER'
                ? () => dispatch({ type: 'SET_ANSWER', playerId: LOCAL_PLAYER_ID, text: String(state.players[LOCAL_PLAYER_ID]?.score ?? 0) })
                : undefined
            }
            canJudge={false}
            onBuzz={() => dispatch({ type: 'BUZZ', playerId: LOCAL_PLAYER_ID })}
            answer={localBuzz?.answer ?? ''}
            onAnswerChange={text =>
              dispatch({ type: 'SET_ANSWER', playerId: LOCAL_PLAYER_ID, text })
            }
            onLockAnswer={text =>
              dispatch({ type: 'LOCK_ANSWER', playerId: LOCAL_PLAYER_ID, answer: text })
            }
            onUnlockAnswer={
              localBuzz?.locked
                ? () => dispatch({ type: 'UNLOCK_ANSWER', playerId: LOCAL_PLAYER_ID })
                : undefined
            }
            reveal={
              state.status === 'REVEAL' || state.status === 'CLUE_EXPIRED'
                ? { correctAnswer: state.activeClue.answer }
                : undefined
            }
            onDismiss={
              state.status === 'CLUE_EXPIRED' &&
              (state.passedPlayerIds?.length ?? 0) > 0
                ? () => dispatch({ type: 'DISMISS_CLUE' })
                : undefined
            }
          />
        </ExpandingClueOverlay>
      )}
      {state.status === 'REVEAL' && onStand && (
        <JudgementTray
          players={Object.values(state.players)}
          localPlayerId={LOCAL_PLAYER_ID}
          stands={[{ playerId: onStand, answer: getBuzz(state, onStand)?.answer ?? '' }]}
          hasMoreToJudge={
            state.activeClue
              ? state.buzzes.some(
                  b => b.playerId !== onStand && !state.activeClue!.failedPlayerIds.includes(b.playerId)
                )
              : false
          }
          onJudge={(judgedId, correct, penalty) =>
            dispatch({
              type: 'JUDGE_ANSWER',
              playerId: judgedId,
              correct,
              ...(penalty !== undefined ? { penalty } : {}),
            })
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
