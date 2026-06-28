import { StyleSheet, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid } from '../theme/tokens';
import { BoardCell, type CellRect } from './BoardCell';
import { CategoryCell } from './CategoryCell';

interface BoardProps {
  board: BoardDefinition;
  burnedClueIds: number[];
  /** True when the local player may not pick (dims the board, blocks touches). */
  locked: boolean;
  onSelectClue?: ((clueId: number, rect: CellRect) => void) | undefined;
  onSkipClue?: ((clueId: number) => void) | undefined;
}

const ROW_COUNT = 5;

export function Board({ board, burnedClueIds, locked, onSelectClue, onSkipClue }: BoardProps) {
  const burned = new Set(burnedClueIds);

  return (
    <View style={styles.board}>
      {/* Category header row */}
      <View style={styles.categoryRow}>
        {board.categories.map(category => (
          <CategoryCell key={category.name} name={category.name} />
        ))}
      </View>

      {/* Value rows */}
      {Array.from({ length: ROW_COUNT }, (_, row) => (
        <View key={row} style={styles.row}>
          {board.categories.map((category, col) => {
            const clue = category.clues[row];
            return (
              <BoardCell
                key={clue?.id ?? `empty-${col}-${row}`}
                value={clue?.value ?? 0}
                burned={clue ? burned.has(clue.id) : false}
                disabled={locked}
                empty={!clue}
                onPress={rect => clue && onSelectClue?.(clue.id, rect)}
                onSkip={clue && onSkipClue ? () => onSkipClue(clue.id) : undefined}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.grid,
    gap: grid.lineWidth,
  },
  categoryRow: {
    flex: 1.25,
    flexDirection: 'row',
    gap: grid.lineWidth,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: grid.lineWidth,
  },
});
