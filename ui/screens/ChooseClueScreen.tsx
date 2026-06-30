import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GameState } from '../../src/types';
import { Board } from '../components/Board';
import type { CellRect } from '../components/BoardCell';
import { PlayerHeader } from '../components/PlayerHeader';
import type { BoardDefinition } from '../fixtures/board';
import { colors } from '../theme/tokens';

interface ChooseClueScreenProps {
  state: GameState;
  /** Which player this device belongs to. */
  localPlayerId: string;
  board: BoardDefinition;
  onSelectClue?: ((clueId: number, rect: CellRect) => void) | undefined;
  onSkipClue?: ((clueId: number) => void) | undefined;
  /** Id of a player who has disconnected. */
  disconnectedPlayerId?: string | null;
}

export function ChooseClueScreen({
  state,
  localPlayerId,
  board,
  onSelectClue,
  onSkipClue,
  disconnectedPlayerId,
}: ChooseClueScreenProps) {
  // null currentTurnPlayerId means anyone may pick the first clue.
  const locked =
    state.currentTurnPlayerId !== null && state.currentTurnPlayerId !== localPlayerId;

  // Remount the board whenever its measured size changes (rotation, initial
  // landscape launch): adjustsFontSizeToFit caches its fitted size and won't
  // recompute when the cell grows, leaving stale tiny/mid-reflow text. Using
  // onLayout (not useWindowDimensions) keys off the size the board actually
  // gets, which is correct even when window metrics are stale at launch.
  const [boardKey, setBoardKey] = useState<string | null>(null);

  return (
    <View style={styles.screen}>
      <PlayerHeader
        players={Object.values(state.players)}
        currentTurnPlayerId={state.currentTurnPlayerId}
        localPlayerId={localPlayerId}
        disconnectedPlayerId={disconnectedPlayerId}
      />
      <View
        style={styles.boardWrap}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setBoardKey(`${Math.round(width)}x${Math.round(height)}`);
        }}
      >
        {boardKey !== null && (
          <Board
            key={boardKey}
            board={board}
            burnedClueIds={state.burnedClueIds}
            locked={locked}
            onSelectClue={onSelectClue}
            onSkipClue={onSkipClue}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 10,
  },
  boardWrap: {
    flex: 1,
  },
});
