import { useMemo, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';
import type { TextStyle, StyleProp } from 'react-native';

/**
 * Text that sizes itself to fill its box as large as possible, choosing the
 * line breaks that maximize the font size.
 *
 * `adjustsFontSizeToFit` is unsupported on react-native-web and greedy-wraps
 * anyway, so a long category like "OSCAR-WINNING SONGS" ends up needlessly
 * small. Here we measure the words with a canvas, try every line count from 1
 * to `maxLines`, balance the words across the lines (minimize the widest line),
 * and pick whichever count yields the biggest font that still fits width AND
 * height. Web-exact; on native (no canvas) we fall back to adjustsFontSizeToFit.
 */

interface AutoFitTextProps {
  children: string;
  maxLines?: number;
  min?: number;
  max?: number;
  /** Horizontal squeeze applied to the visible text (e.g. scaleX 0.85), so we
   *  budget that much more layout width. */
  widthScale?: number;
  /** Line box height as a multiple of font size (kept in sync with lineHeight). */
  lineHeightRatio?: number;
  style?: StyleProp<TextStyle>;
}

let sharedCtx: CanvasRenderingContext2D | null | undefined;
function getCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx !== undefined) return sharedCtx;
  sharedCtx =
    Platform.OS === 'web' && typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : null;
  return sharedCtx;
}

/** Split words into ≤ L contiguous lines minimizing the widest line. */
function balance(wordW: number[], spaceW: number, L: number): { groups: [number, number][]; maxWidth: number } {
  const n = wordW.length;
  const maxWord = Math.max(...wordW);
  const totalW = wordW.reduce((a, b) => a + b, 0) + spaceW * (n - 1);

  const linesFor = (limit: number): number => {
    let lines = 1;
    let cur = 0;
    for (let k = 0; k < n; k++) {
      if (cur === 0) cur = wordW[k]!;
      else if (cur + spaceW + wordW[k]! <= limit + 0.01) cur += spaceW + wordW[k]!;
      else {
        lines++;
        cur = wordW[k]!;
      }
    }
    return lines;
  };

  // Smallest max-line-width that still fits in ≤ L lines (book-allocation).
  let lo = maxWord;
  let hi = totalW;
  for (let it = 0; it < 28; it++) {
    const mid = (lo + hi) / 2;
    if (linesFor(mid) <= L) hi = mid;
    else lo = mid;
  }

  const groups: [number, number][] = [];
  let start = 0;
  let cur = 0;
  for (let k = 0; k < n; k++) {
    if (cur === 0) {
      cur = wordW[k]!;
      start = k;
    } else if (cur + spaceW + wordW[k]! <= hi + 0.01) {
      cur += spaceW + wordW[k]!;
    } else {
      groups.push([start, k - 1]);
      cur = wordW[k]!;
      start = k;
    }
  }
  groups.push([start, n - 1]);

  const width = ([i, j]: [number, number]): number => {
    let s = 0;
    for (let k = i; k <= j; k++) s += wordW[k]!;
    return s + spaceW * (j - i);
  };
  return { groups, maxWidth: Math.max(...groups.map(width)) };
}

function fit(
  text: string,
  boxW: number,
  boxH: number,
  family: string,
  weight: string,
  widthScale: number,
  lineHeightRatio: number,
  maxLines: number,
  min: number,
  max: number,
): { fontSize: number; text: string } | null {
  const ctx = getCtx();
  if (!ctx) return null;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { fontSize: min, text };

  const R = 100; // reference size — widths scale linearly with font size
  ctx.font = `${weight} ${R}px ${family}`;
  const wordW = words.map(w => ctx.measureText(w).width);
  const spaceW = ctx.measureText(' ').width;
  const widthBudget = boxW / widthScale;

  // Categories read like the broadcast: fill most of the WIDTH, with height
  // only as a safety clamp (leave a little margin on each so text never touches
  // the cell edges or overflows).
  const WIDTH_FILL = 0.92;
  const HEIGHT_FILL = 0.88;

  let best: { fontSize: number; text: string; lines: number } | null = null;
  const maxL = Math.min(maxLines, words.length);
  for (let L = 1; L <= maxL; L++) {
    const { groups, maxWidth } = balance(wordW, spaceW, L);
    const nLines = groups.length;
    const byWidth = (WIDTH_FILL * widthBudget * R) / maxWidth;
    const byHeight = (HEIGHT_FILL * boxH) / (nLines * lineHeightRatio);
    const fontSize = Math.min(byWidth, byHeight, max);
    // Prefer this line count only if it's meaningfully bigger — avoids awkward
    // extra breaks (a lonely trailing word) for a hair more size.
    if (!best || fontSize > best.fontSize * 1.06) {
      best = {
        fontSize,
        lines: nLines,
        text: groups.map(([i, j]) => words.slice(i, j + 1).join(' ')).join('\n'),
      };
    }
  }
  if (best) best.fontSize = Math.max(min, best.fontSize);
  return best;
}

export function AutoFitText({
  children,
  maxLines = 4,
  min = 8,
  max = 44,
  widthScale = 1,
  lineHeightRatio = 1.28,
  style,
}: AutoFitTextProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const family = (flat.fontFamily as string) ?? 'System';
  const weight = (flat.fontWeight as string) ?? '400';

  const result = useMemo(
    () =>
      box && box.w > 0 && box.h > 0
        ? fit(children, box.w, box.h, family, weight, widthScale, lineHeightRatio, maxLines, min, max)
        : null,
    [children, box?.w, box?.h, family, weight, widthScale, lineHeightRatio, maxLines, min, max],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox(prev => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  return (
    <View style={styles.fill} onLayout={onLayout}>
      {box &&
        (result ? (
          <Text
            style={[style, { fontSize: result.fontSize, lineHeight: result.fontSize * lineHeightRatio }]}
            numberOfLines={maxLines}
          >
            {result.text}
          </Text>
        ) : (
          // Native fallback (no canvas): adjustsFontSizeToFit works there.
          <Text style={[style, { fontSize: max }]} numberOfLines={maxLines} adjustsFontSizeToFit allowFontScaling={false}>
            {children}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
