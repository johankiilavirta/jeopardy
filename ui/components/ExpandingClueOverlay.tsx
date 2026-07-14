import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import type { CellRect } from './BoardCell';

/** Expand duration, board cell → full screen. */
const EXPAND_MS = 250;

interface ExpandingClueOverlayProps {
  /** The tapped grid cell's rect in window coords — the card grows from here.
   *  Null (e.g. a clue another player picked) means no animation. */
  fromRect: CellRect | null;
  /** When false, the overlay just fills the screen instantly. */
  animate: boolean;
  /** How much space the child's layout keeps clear at the bottom (the
   *  player bar). The overlay itself fills the whole screen — so bottom
   *  sheets inside can dock to the true bottom edge and stay tappable —
   *  and this is only used to aim the grow animation at the card's
   *  visual center. */
  bottomInset?: number | undefined;
  children: React.ReactNode;
}

/** The card's width as a fraction of the screen — must equal
 *  1 - 2 * CARD_H_PAD (the card's 5% side margins in ClueScreen). */
const CARD_WIDTH_FRACTION = 0.9;

/**
 * Full-screen overlay for the active clue. When `animate` and a `fromRect` are
 * given, the overlay starts scaled + translated to sit exactly over the tapped
 * board cell, then grows to fill the screen — so the clue card looks like it
 * expands straight out of the grid. We calculate the math synchronously based
 * on the window dimensions to prevent asynchronous layout measurement failures
 * or flash frames.
 *
 * Mount this keyed by clue id so each pick replays the grow.
 */
export function ExpandingClueOverlay({ fromRect, animate, bottomInset = 0, children }: ExpandingClueOverlayProps) {
  const { width: ow, height: oh } = useWindowDimensions();
  const willAnimate = animate && !!fromRect;
  const progress = useRef(new Animated.Value(willAnimate ? 0 : 1)).current;

  useEffect(() => {
    if (willAnimate) {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: EXPAND_MS,
        // Linear: the box grows at a constant rate, matching the broadcast.
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
  }, [willAnimate, progress]);

  // Calculate start parameters synchronously.
  // We calculate the start scale `k` so the inner blue card matches the cell width exactly.
  const cardWidth = ow * CARD_WIDTH_FRACTION;
  const start = fromRect
    ? {
        cx: fromRect.x + fromRect.width / 2,
        cy: fromRect.y + fromRect.height / 2,
        k: fromRect.width / cardWidth,
      }
    : null;

  // Scale is uniform and anchored at the overlay's center, so we translate
  // to put the card's center over the cell's center at the start. The card's
  // visual center sits bottomInset/2 above the overlay center (its layout
  // leaves bottomInset clear at the bottom), and that offset shrinks with
  // the scale — hence the `k` term.
  const transform = start
    ? [
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [start.cx - ow / 2, 0],
          }),
        },
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [start.cy - oh / 2 + (bottomInset / 2) * start.k, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [start.k, 1],
          }),
        },
      ]
    : [];

  return (
    <Animated.View
      style={[
        styles.fill,
        {
          transformOrigin: 'center',
          transform,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
