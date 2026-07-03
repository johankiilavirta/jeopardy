import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid, type as typeTokens } from '../theme/tokens';
import { BoardCell, type CellRect } from './BoardCell';
import { CategoryCell } from './CategoryCell';

interface BoardProps {
  board: BoardDefinition;
  burnedClueIds: number[];
  locked: boolean;
  onSelectClue?: ((clueId: number, rect: CellRect) => void) | undefined;
  onSkipClue?: ((clueId: number) => void) | undefined;
  /**
   * Increments to 1 the first time Double Jeopardy starts, triggering the
   * board-intro flash sequence. 0 (default) = no animation.
   */
  boardAnimKey?: number | undefined;
}

const ROW_COUNT = 5;
const COL_COUNT = 6;
const ROW_FLEX_TOTAL = 1.25 + ROW_COUNT;
const PROBE_FONT = 100;
const VALUE_SCALE_X = 0.85;
const CELL_PAD_X = 4;
const VALUE_FILL = 0.9;

/** Number of distinct flash waves across the board. */
const WAVES = 6;
/** Ms between each wave. */
const WAVE_MS = 455;
/** Pause before the first wave so the board is visibly dark for a beat. */
const WAVE_OFFSET = 350;
/** Categories flash on after all waves have fired. */
const CAT_FLASH_DELAY = WAVE_OFFSET + WAVES * WAVE_MS + 200;

export function Board({ board, burnedClueIds, locked, onSelectClue, onSkipClue, boardAnimKey = 0 }: BoardProps) {
  const burned = new Set(burnedClueIds);
  const baseValue = board.categories.find(c => c.clues.length > 0)?.clues[0]?.value ?? 200;
  const [boardSize, setBoardSize] = useState<{ w: number; h: number } | null>(null);
  const [probe, setProbe] = useState<{ w: number; h: number } | null>(null);

  // Assign all 30 cells to 6 waves (5 cells each) with the constraint that each
  // wave contains at most one cell per column and one cell per row.
  // Construction: wave w, row r → column (r + w) % COL_COUNT. This is a cyclic
  // Latin rectangle — each wave gets one cell from every row and 5 of 6 columns.
  // Random permutations on rows, columns, and wave-firing order make each game
  // look different while preserving the constraint exactly (no remainder).
  const cellDelays = useMemo<number[] | null>(() => {
    if (!boardAnimKey) return null;

    function shuffle(n: number): number[] {
      const a = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i]!; a[i] = a[j]!; a[j] = tmp;
      }
      return a;
    }

    const colPerm = shuffle(COL_COUNT); // randomise which physical col = logical col
    const rowPerm = shuffle(ROW_COUNT); // randomise which physical row = logical row
    const waveStep = shuffle(WAVES);    // randomise which step each wave fires at

    const delays = new Array<number>(COL_COUNT * ROW_COUNT);
    for (let w = 0; w < WAVES; w++) {
      for (let r = 0; r < ROW_COUNT; r++) {
        const physCol = colPerm[(r + w) % COL_COUNT]!;
        const physRow = rowPerm[r]!;
        delays[physCol * ROW_COUNT + physRow] = WAVE_OFFSET + waveStep[w]! * WAVE_MS;
      }
    }
    return delays;
  }, [boardAnimKey]);

  let valueFontSize: number | undefined;
  if (boardSize && probe && probe.w > 0 && probe.h > 0) {
    const cellW = (boardSize.w - (COL_COUNT - 1) * grid.lineWidth) / COL_COUNT;
    const innerW = cellW - 2 * CELL_PAD_X;
    const rowsAreaH = boardSize.h - ROW_COUNT * grid.lineWidth;
    const valueRowH = rowsAreaH / ROW_FLEX_TOTAL;
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

      <View style={styles.categoryRow}>
        {board.categories.map(category => (
          <CategoryCell
            key={category.name}
            name={category.name}
            flashDelay={cellDelays ? CAT_FLASH_DELAY : undefined}
          />
        ))}
      </View>

      {Array.from({ length: ROW_COUNT }, (_, row) => (
        <View key={row} style={styles.row}>
          {board.categories.map((category, col) => {
            const clue = category.clues[row];
            const dead = clue ? burned.has(clue.id) : true;
            const cellIdx = col * ROW_COUNT + row;
            return (
              <BoardCell
                key={clue?.id ?? `empty-${col}-${row}`}
                value={clue?.value ?? (row + 1) * baseValue}
                valueFontSize={valueFontSize}
                burned={clue ? burned.has(clue.id) : false}
                disabled={locked}
                empty={!clue}
                onPress={rect => clue && onSelectClue?.(clue.id, rect)}
                onSkip={clue && onSkipClue ? () => onSkipClue(clue.id) : undefined}
                flashDelay={cellDelays && !dead ? cellDelays[cellIdx] : undefined}
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
  probe: {
    position: 'absolute',
    opacity: 0,
    fontFamily: typeTokens.board,
    fontSize: PROBE_FONT,
    letterSpacing: -0.5,
  },
});
