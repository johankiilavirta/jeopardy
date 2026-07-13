import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid, type as typeTokens } from '../theme/tokens';
import { fit as computeFit } from './AutoFitText';
import { BoardCell, type CellRect } from './BoardCell';
import { CategoryCell, CAT_PAD_X, CAT_PAD_Y } from './CategoryCell';

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
const ROW_FLEX_TOTAL = 1.25 + ROW_COUNT;
const PROBE_FONT = 100;
const VALUE_SCALE_X = 0.85;
const CELL_PAD_X = 4;
const VALUE_FILL = 0.9;
const WAVE_MS = 455;
const WAVE_OFFSET = 350;

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!; a[i] = a[j]!; a[j] = tmp;
  }
  return a;
}

export function Board({ board, burnedClueIds, locked, onSelectClue, onSkipClue, boardAnimKey = 0 }: BoardProps) {
  const burned = new Set(burnedClueIds);
  const baseValue = board.categories.find(c => c.clues.length > 0)?.clues[0]?.value ?? 200;
  const [boardSize, setBoardSize] = useState<{ w: number; h: number } | null>(null);
  const [probe, setProbe] = useState<{ w: number; h: number } | null>(null);

  const colCount = board.categories.length;

  // waves = max(cols, rows); cells-per-wave = min(cols, rows).
  // When cols >= rows: cycle columns — wave w, row r → col (r+w) % cols.
  // When cols <  rows: cycle rows    — wave w, col c → row (c+w) % rows.
  // Both guarantee exactly one cell per column AND per row within each wave,
  // and every cell covered exactly once across all waves.
  const waves = Math.max(colCount, ROW_COUNT);
  const catFlashDelay = WAVE_OFFSET + waves * WAVE_MS + 200;

  const cellDelays = useMemo<number[] | null>(() => {
    if (!boardAnimKey) return null;

    const cols = colCount;
    const waveCount = Math.max(cols, ROW_COUNT);
    const colPerm = shuffle(cols);
    const rowPerm = shuffle(ROW_COUNT);
    const waveStep = shuffle(waveCount);
    const delays = new Array<number>(cols * ROW_COUNT);

    if (cols >= ROW_COUNT) {
      for (let w = 0; w < waveCount; w++) {
        for (let r = 0; r < ROW_COUNT; r++) {
          const physCol = colPerm[(r + w) % cols]!;
          const physRow = rowPerm[r]!;
          delays[physCol * ROW_COUNT + physRow] = WAVE_OFFSET + waveStep[w]! * WAVE_MS;
        }
      }
    } else {
      for (let w = 0; w < waveCount; w++) {
        for (let c = 0; c < cols; c++) {
          const physCol = colPerm[c]!;
          const physRow = rowPerm[(c + w) % ROW_COUNT]!;
          delays[physCol * ROW_COUNT + physRow] = WAVE_OFFSET + waveStep[w]! * WAVE_MS;
        }
      }
    }
    return delays;
  // colCount included: if it changes (board swap), recompute delays for new size.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardAnimKey, colCount]);

  let valueFontSize: number | undefined;
  if (boardSize && probe && probe.w > 0 && probe.h > 0) {
    const cellW = (boardSize.w - (colCount - 1) * grid.lineWidth) / colCount;
    const innerW = cellW - 2 * CELL_PAD_X;
    const rowsAreaH = boardSize.h - ROW_COUNT * grid.lineWidth;
    const valueRowH = rowsAreaH / ROW_FLEX_TOTAL;
    const fByWidth = (PROBE_FONT * innerW) / (probe.w * VALUE_SCALE_X);
    const fByHeight = (PROBE_FONT * valueRowH) / probe.h;
    valueFontSize = Math.max(8, Math.min(fByWidth, fByHeight) * VALUE_FILL);
  }

  // Equal category text sizing: compute fits for every category, take the
  // minimum font size, then re-fit each at that shared ceiling so line breaks
  // are optimised for the final size. Mirrors the broadcast where all headers
  // sit at the same visual weight. Falls back to per-cell AutoFitText on
  // native (no canvas).
  const categoryFits = useMemo(() => {
    if (!boardSize) return null;
    const cellW = (boardSize.w - (colCount - 1) * grid.lineWidth) / colCount;
    const innerW = cellW - 2 * CAT_PAD_X;
    const totalAvailH = boardSize.h - 5 * grid.lineWidth;
    const catRowH = totalAvailH * 1.25 / ROW_FLEX_TOTAL;
    const innerH = catRowH - 2 * CAT_PAD_Y;
    if (innerW <= 0 || innerH <= 0) return null;

    const names = board.categories.map(c => c.name.toUpperCase());
    const individual = names.map(n =>
      computeFit(n, innerW, innerH, typeTokens.board, '400', 0.85, 1.28, 3, 8, 44),
    );
    if (individual.some(f => f === null)) return null;

    const minSize = Math.min(...individual.map(f => f!.fontSize));

    // Re-fit with the shared ceiling so each name picks optimal line breaks
    // at the final size.
    return names.map(n =>
      computeFit(n, innerW, innerH, typeTokens.board, '400', 0.85, 1.28, 3, 8, minSize),
    );
  }, [boardSize, board.categories, colCount]);

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
        {board.categories.map((category, i) => (
          <CategoryCell
            key={category.name}
            name={category.name}
            flashDelay={cellDelays ? catFlashDelay : undefined}
            precomputedFit={categoryFits?.[i] ?? undefined}
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
