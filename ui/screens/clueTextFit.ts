export const DEFAULT_CLUE_FONT_SIZE = 26;
export const DEFAULT_CLUE_LINE_HEIGHT = 38;
export const MIN_CLUE_FONT_SIZE = 16;
export const REVEAL_ANSWER_GAP = 28;

/** The clue remains vertically centered while the answer appears below it,
 *  so the reveal needs matching clearance above and below that center line. */
export function clueHeightAvailableForReveal(
  bodyHeight: number,
  answerHeight: number,
): number {
  return Math.max(
    DEFAULT_CLUE_LINE_HEIGHT,
    bodyHeight - 2 * (REVEAL_ANSWER_GAP + answerHeight),
  );
}

/** Return the next font size only when the rendered clue truly overflows.
 *  Step down one pixel per layout pass: a proportional jump can overshoot
 *  badly once the smaller text reflows onto fewer lines. */
export function nextFittedClueFontSize(
  currentSize: number,
  renderedHeight: number,
  availableHeight: number,
): number {
  if (renderedHeight <= availableHeight || currentSize <= MIN_CLUE_FONT_SIZE) {
    return currentSize;
  }

  return Math.max(MIN_CLUE_FONT_SIZE, currentSize - 1);
}

export function clueLineHeight(fontSize: number): number {
  return Math.round(DEFAULT_CLUE_LINE_HEIGHT * fontSize / DEFAULT_CLUE_FONT_SIZE);
}
