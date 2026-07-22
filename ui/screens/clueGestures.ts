export type VerticalClueGesture = 'keyboard-dismiss' | 'skip' | 'summon' | null;

export const VERTICAL_GESTURE_START = 15;
export const SKIP_COMMIT_DISTANCE = 80;

interface VerticalClueGestureOptions {
  keyboardVisible: boolean;
  canSkip: boolean;
  canSummon: boolean;
}

/** Choose exactly one owner for a vertical clue-screen gesture. Downward
 *  motion can never summon a keyboard: it dismisses an already-visible
 *  keyboard first, otherwise it pulls the skip affordance. */
export function verticalClueGesture(
  dx: number,
  dy: number,
  options: VerticalClueGestureOptions,
): VerticalClueGesture {
  const vertical =
    Math.abs(dy) > VERTICAL_GESTURE_START &&
    Math.abs(dy) > Math.abs(dx) * 1.5;
  if (!vertical) return null;

  if (dy > 0) {
    if (options.keyboardVisible) return 'keyboard-dismiss';
    return options.canSkip ? 'skip' : null;
  }

  return options.canSummon ? 'summon' : null;
}

/** Skip is distance-only and commits on release, preventing a short fast
 *  flick from accidentally passing on a clue. */
export function shouldCommitSkip(distance: number): boolean {
  return distance >= SKIP_COMMIT_DISTANCE;
}

