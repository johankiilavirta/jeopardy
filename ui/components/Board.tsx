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

  // Event delegation: one contextmenu listener on the board container.
  // Each live cell carries a data-clue-id attribute; we walk up from the
  // click target to find it, then dispatch the skip.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onSkipClue) return;
    const el = boardRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest('[data-clue-id]');
      if (!target) return;
      const clueId = parseInt(target.getAttribute('data-clue-id') ?? '', 10);
      if (!isNaN(clueId)) {
        e.preventDefault();
        onSkipClue(clueId);
      }
    };
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
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
