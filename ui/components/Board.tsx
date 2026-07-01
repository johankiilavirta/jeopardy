import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid, type as typeTokens } from '../theme/tokens';
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
const COL_COUNT = 6;
/** Rows are 1 category row (flex 1.25) + 5 value rows (flex 1). */
const ROW_FLEX_TOTAL = 1.25 + ROW_COUNT;

// Uniform value sizing. Every dollar value renders at the *same* font size —
// computed from the widest value ("$1000") so it fits any cell — rather than
// each cell auto-shrinking on its own (which made "$1000" smaller than "$200").
const PROBE_FONT = 100; // reference size the hidden "$1000" probe is measured at
const VALUE_SCALE_X = 0.85; // must match BoardCell's value transform
const CELL_PAD_X = 4; // must match BoardCell's cell paddingHorizontal
/** Fraction of the binding cell dimension the value text fills. */
const VALUE_FILL = 0.9;

export function Board({ board, burnedClueIds, locked, onSelectClue, onSkipClue }: BoardProps) {
  const burned = new Set(burnedClueIds);
  const [boardSize, setBoardSize] = useState<{ w: number; h: number } | null>(null);
  // Natural size of "$1000" at PROBE_FONT (no transform); width scales linearly
  // with font size, so one measurement gives us the exact fit for every cell.
  const [probe, setProbe] = useState<{ w: number; h: number } | null>(null);

  let valueFontSize: number | undefined;
  if (boardSize && probe && probe.w > 0 && probe.h > 0) {
    const cellW = (boardSize.w - (COL_COUNT - 1) * grid.lineWidth) / COL_COUNT;
    const innerW = cellW - 2 * CELL_PAD_X;
    const rowsAreaH = boardSize.h - ROW_COUNT * grid.lineWidth; // 6 rows → 5 gaps
    const valueRowH = rowsAreaH / ROW_FLEX_TOTAL;
    // Account for the scaleX squeeze when fitting width; height is raw.
    const fByWidth = (PROBE_FONT * innerW) / (probe.w * VALUE_SCALE_X);
    const fByHeight = (PROBE_FONT * valueRowH) / probe.h;
    valueFontSize = Math.max(8, Math.min(fByWidth, fByHeight) * VALUE_FILL);
  }

  return (
    <View
      style={styles.board}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        setBoardSize(prev =>
          prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
    >
      {/* Hidden probe: the widest value, measured once at a reference font size. */}
      <Text
        style={styles.probe}
        numberOfLines={1}
        allowFontScaling={false}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setProbe(prev =>
            prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
          );
        }}
      >
        $1000
      </Text>

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
                valueFontSize={valueFontSize}
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
  // Off-flow, invisible — only here to be measured. Mirrors the value text's
  // font and letterSpacing (the scaleX transform doesn't affect layout width,
  // so it's left off and accounted for in the math instead).
  probe: {
    position: 'absolute',
    opacity: 0,
    fontFamily: typeTokens.board,
    fontSize: PROBE_FONT,
    letterSpacing: -0.5,
  },
});
