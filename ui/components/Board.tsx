import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { BoardDefinition } from '../fixtures/board';
import { colors, grid, type as typeTokens } from '../theme/tokens';
import { fit as computeFit } from './AutoFitText';
import { BoardCell, type CellRect } from './BoardCell';
import { CategoryCell, CAT_PAD_X, CAT_PAD_Y } from './CategoryCell';
import { sanitizeText } from '../../src/sanitizeText';

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
  /**
   * Fires once the measurement-driven font sizing has settled (value font
   * size and category fits computed) — the board is fully formed and safe
   * to reveal.
   */
  onReady?: (() => void) | undefined;
  /** Optional cap for category text; useful for short labels like dates. */
  categoryMaxFontSize?: number | undefined;
}

const ROW_COUNT = 5;
const ROW_FLEX_TOTAL = 1.25 + ROW_COUNT;
const PROBE_FONT = 100;
const VALUE_SCALE_X = 0.85;
const CELL_PAD_X = 4;
const VALUE_FILL = 0.9;
const WAVE_MS = 455;
const WAVE_OFFSET = 350;

function balancedGroups(widths: number[], spaceWidth: number, maxLines: number): { groups: [number, number][]; maxWidth: number } {
  const lineCount = Math.min(maxLines, widths.length);
  const lineWidth = (start: number, end: number) =>
    widths.slice(start, end + 1).reduce((sum, width) => sum + width, 0) + spaceWidth * (end - start);
  const linesFor = (limit: number) => {
    let lines = 1;
    let current = 0;
    for (const width of widths) {
      if (current === 0) current = width;
      else if (current + spaceWidth + width <= limit + 0.01) current += spaceWidth + width;
      else { lines++; current = width; }
    }
    return lines;
  };

  let low = Math.max(...widths);
  let high = widths.reduce((sum, width) => sum + width, 0) + spaceWidth * Math.max(0, widths.length - 1);
  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2;
    if (linesFor(mid) <= lineCount) high = mid;
    else low = mid;
  }

  const groups: [number, number][] = [];
  let start = 0;
  let current = 0;
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i]!;
    if (current === 0) current = width;
    else if (current + spaceWidth + width <= high + 0.01) current += spaceWidth + width;
    else {
      groups.push([start, i - 1]);
      start = i;
      current = width;
    }
  }
  groups.push([start, widths.length - 1]);
  return { groups, maxWidth: Math.max(...groups.map(([start, end]) => lineWidth(start, end))) };
}

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!; a[i] = a[j]!; a[j] = tmp;
  }
  return a;
}

function BoardImpl({ board, burnedClueIds, locked, onSelectClue, onSkipClue, boardAnimKey = 0, onReady, categoryMaxFontSize = 44 }: BoardProps) {
  // Lobby metadata can arrive directly from the relay rather than through
  // gameLoader, so normalize it here as well. Fitting and rendering must use
  // the same display string or escaped quotes/backslashes can cause ellipses.
  const categories = useMemo(
    () => board.categories.map(category => ({ ...category, name: sanitizeText(category.name) })),
    [board.categories],
  );
  const burned = new Set(burnedClueIds);
  const baseValue = categories.find(c => c.clues.length > 0)?.clues[0]?.value ?? 200;
  const [boardSize, setBoardSize] = useState<{ w: number; h: number } | null>(null);
  const [probe, setProbe] = useState<{ w: number; h: number } | null>(null);
  // Native fallback: measured single-word widths at PROBE_FONT. Explicit word
  // measurements let us choose safe line breaks instead of splitting a long
  // word when React Native lays out the final category text.
  const [wordProbes, setWordProbes] = useState<Record<string, number>>({});
  const [spaceProbe, setSpaceProbe] = useState<number | null>(null);

  const colCount = categories.length;

  // waves = max(cols, rows); cells-per-wave = min(cols, rows).
  // When cols >= rows: cycle columns — wave w, row r → col (r+w) % cols.
  // When cols <  rows: cycle rows    — wave w, col c → row (c+w) % rows.
  // Both guarantee exactly one cell per column AND per row within each wave,
  // and every cell covered exactly once across all waves.
  const waves = Math.max(colCount, ROW_COUNT);
  const catFlashDelay = WAVE_OFFSET + waves * WAVE_MS + 200;

  // The flash only plays when boardAnimKey *changes* after mount (the live
  // round 1 → 2 transition). Mounting with the key already latched — resuming
  // or rejoining straight into Double Jeopardy, or a size-change remount after
  // the transition — must not replay it.
  const initialAnimKeyRef = useRef(boardAnimKey);
  const cellDelays = useMemo<number[] | null>(() => {
    if (!boardAnimKey || boardAnimKey === initialAnimKeyRef.current) return null;

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
  // sit at the same visual weight.
  const categoryFits = useMemo(() => {
    if (!boardSize) return null;
    const cellW = (boardSize.w - (colCount - 1) * grid.lineWidth) / colCount;
    const innerW = cellW - 2 * CAT_PAD_X;
    const totalAvailH = boardSize.h - 5 * grid.lineWidth;
    const catRowH = totalAvailH * 1.25 / ROW_FLEX_TOTAL;
    const innerH = catRowH - 2 * CAT_PAD_Y;
    if (innerW <= 0 || innerH <= 0) return null;

    const names = categories.map(c => c.name.toUpperCase());
    const nonEmptyNames = names.filter(Boolean);
    if (nonEmptyNames.length === 0) {
      return names.map(() => ({ fontSize: categoryMaxFontSize, text: '' }));
    }

    // --- Web path: canvas measurement with balanced line breaks ---
    const webFits = nonEmptyNames.map(n =>
      computeFit(n, innerW, innerH, typeTokens.board, '400', 0.85, 1.28, 3, 8, categoryMaxFontSize),
    );
    if (!webFits.some(f => f === null)) {
      const minSize = Math.min(...webFits.map(f => f!.fontSize));
      return names.map(n =>
        n ? computeFit(n, innerW, innerH, typeTokens.board, '400', 0.85, 1.28, 3, 8, minSize) : { fontSize: minSize, text: '' },
      );
    }

    // --- Native fallback: derive sizing and line breaks from word probes ---
    const allWords = categories.flatMap(category => category.name.toUpperCase().split(/\s+/).filter(Boolean));
    if (spaceProbe == null || !allWords.every(word => wordProbes[word] != null)) return null;

    const WIDTH_FILL = 0.92;
    const HEIGHT_FILL = 0.88;
    // scaleX is applied after layout; wrapping still has to fit the real cell.
    const widthBudget = innerW;

    const nativeFit = (name: string, maxFont: number) => {
      const words = name.toUpperCase().split(/\s+/).filter(Boolean);
      const widths = words.map(word => wordProbes[word]!);
      let best: { fontSize: number; text: string } | null = null;
      for (let lines = 1; lines <= Math.min(3, words.length); lines++) {
        const layout = balancedGroups(widths, spaceProbe, lines);
        const byWidth = (WIDTH_FILL * widthBudget * PROBE_FONT) / layout.maxWidth;
        const byHeight = (HEIGHT_FILL * innerH) / (layout.groups.length * 1.28);
        const fontSize = Math.min(byWidth, byHeight, maxFont);
        if (!best || fontSize > best.fontSize * 1.06) {
          best = {
            fontSize,
            text: layout.groups
              .map(([start, end]) => words.slice(start, end + 1).join(' '))
              .join('\n'),
          };
        }
      }
      return best ?? { fontSize: 8, text: name };
    };

    let minFontSize = categoryMaxFontSize;
    for (const cat of categories.filter(category => category.name.trim().length > 0)) {
      minFontSize = Math.min(minFontSize, nativeFit(cat.name, categoryMaxFontSize).fontSize);
    }

    return names.map(n => n ? nativeFit(n, minFontSize) : { fontSize: minFontSize, text: '' });
  }, [boardSize, categories, categoryMaxFontSize, colCount, spaceProbe, wordProbes]);

  // Font sizing is measurement-driven (onLayout probes land over several
  // frames), so a freshly mounted board visibly assembles itself: values at
  // a guessed size, then a snap, then category titles. Report readiness so
  // the parent can hold the board (and score bar) hidden until it's fully
  // formed. Probes still measure at opacity 0 — opacity doesn't skip layout.
  const ready = valueFontSize != null && categoryFits != null;
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);

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

      {/* Word probes: measure each token at PROBE_FONT so native layout can
          choose explicit word boundaries for up to three lines. */}
      {Array.from(new Set(categories.flatMap(category => category.name.toUpperCase().split(/\s+/).filter(Boolean)))).map(word => (
        <Text
          key={`word-probe-${word}`}
          style={styles.catProbe}
          numberOfLines={1}
          allowFontScaling={false}
          onLayout={e => {
            const w = e.nativeEvent.layout.width;
            setWordProbes(prev => prev[word] === w ? prev : { ...prev, [word]: w });
          }}
        >
          {word}
        </Text>
      ))}
      <Text
        style={styles.catProbe}
        numberOfLines={1}
        allowFontScaling={false}
        onLayout={e => {
          const w = e.nativeEvent.layout.width;
          setSpaceProbe(prev => prev === w ? prev : w);
        }}
      >
        {' '}
      </Text>

      <View style={styles.categoryRow}>
        {categories.map((category, i) => (
          <CategoryCell
            key={`category-${i}`}
            name={category.name}
            flashDelay={cellDelays ? catFlashDelay : undefined}
            precomputedFit={categoryFits?.[i] ?? undefined}
            maxFontSize={categoryMaxFontSize}
          />
        ))}
      </View>

      {Array.from({ length: ROW_COUNT }, (_, row) => (
        <View key={row} style={styles.row}>
          {categories.map((category, col) => {
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

/** The board re-renders only when its inputs really change. Every network
 *  STATE_UPDATE deserializes a fresh burned array, so it compares by
 *  content; everything else compares by identity (the parent memoizes the
 *  board object and callbacks). Typing and buzzing skip this subtree. */
export const Board = memo(BoardImpl, (a, b) =>
  a.board === b.board &&
  a.locked === b.locked &&
  a.onSelectClue === b.onSelectClue &&
  a.onSkipClue === b.onSkipClue &&
  a.boardAnimKey === b.boardAnimKey &&
  a.onReady === b.onReady &&
  a.categoryMaxFontSize === b.categoryMaxFontSize &&
  a.burnedClueIds.length === b.burnedClueIds.length &&
  a.burnedClueIds.every((id, i) => id === b.burnedClueIds[i]),
);

const styles = StyleSheet.create({
  board: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.background,
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
  catProbe: {
    position: 'absolute',
    opacity: 0,
    fontFamily: typeTokens.board,
    fontSize: PROBE_FONT,
  },
});
