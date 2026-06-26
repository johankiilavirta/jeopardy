import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
  onSkipClue?: ((clueId: number) => void) | undefined;
}

const ROW_COUNT = 5;

export function Board({ board, burnedClueIds, locked, onSelectClue, onSkipClue }: BoardProps) {
  const burned = new Set(burnedClueIds);
  const boardRef = useRef<View>(null);

  // Attach to document (guaranteed to fire) and scope to the board element.
  // Prevents the native context menu anywhere on the board, and dispatches
  // skip when a cell with data-clue-id is right-clicked.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onSkipClue) return;
    const handler = (e: MouseEvent) => {
      const board = boardRef.current as unknown as HTMLElement | null;
      if (!board?.contains(e.target as Node)) return;
      e.preventDefault();
      const cell = (e.target as HTMLElement | null)?.closest('[data-clue-id]');
      if (!cell) return;
      const clueId = parseInt(cell.getAttribute('data-clue-id') ?? '', 10);
      if (!isNaN(clueId)) onSkipClue(clueId);
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, [onSkipClue]);

  return (
    <View ref={boardRef} style={styles.board}>
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
                {...(clue ? { clueId: clue.id } : {})}
                onPress={() => clue && onSelectClue?.(clue.id)}
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
