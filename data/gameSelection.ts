import type { GameInfo } from './gameLoader';

/** A game is swipe-selectable only when every available category is complete. */
export function hasCompleteCategories(info: GameInfo | null): boolean {
  if (!info) return false;
  return [...info.round1, ...info.round2].every(category => category.clueCount >= 5);
}

/**
 * Move through valid game numbers, counting only games with complete
 * categories. The range is clamped at the archive edges rather than wrapping
 * around, which keeps a fast swipe predictable.
 */
export function nextCompleteGameNumber(
  start: number,
  direction: -1 | 1,
  steps: number,
  totalGames: number,
  getInfo: (gameNumber: number) => GameInfo | null,
): number {
  let candidate = Math.max(1, Math.min(totalGames, Math.trunc(start)));
  let remaining = Math.max(1, Math.trunc(steps));

  while (remaining > 0) {
    const next = candidate + direction;
    if (next < 1 || next > totalGames) return candidate;
    candidate = next;
    if (hasCompleteCategories(getInfo(candidate))) remaining -= 1;
  }
  return candidate;
}
