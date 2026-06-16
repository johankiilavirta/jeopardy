import { StyleSheet, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid } from '../theme/tokens';
import { BoardCell } from './BoardCell';
import { CategoryCell } from './CategoryCell';

interface BoardProps {
  board: BoardDefinition;
  burnedClueIds: number[];
  /** True when the local player may not pick (dims the board, blocks touches). */
  locked: boolean;
  onSelectClue?: ((clueId: number) => void) | undefined;
}

const ROW_COUNT = 5;

export function Board({ board, burnedClueIds, locked, onSelectClue }: BoardProps) {
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
          {board.categories.map(category => {
            const clue = category.clues[row];
            if (!clue) return null;
            return (
              <BoardCell
                key={clue.id}
                value={clue.value}
                burned={burned.has(clue.id)}
                disabled={locked}
                onPress={() => onSelectClue?.(clue.id)}
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
    // Black container + gaps between cells reveal crisp 2px grid lines.
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
