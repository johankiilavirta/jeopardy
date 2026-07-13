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
  /** Leaves a persistent UI element (such as the player bar) uncovered. */
  bottomInset?: number | undefined;
  children: React.ReactNode;
}

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
  // The card has marginHorizontal: '2%' (meaning 96% width) at scale 1.
  // We calculate the start scale `k` so the inner blue card matches the cell width exactly.
  const cardWidth = ow * 0.96;
  const start = fromRect
    ? {
        cx: fromRect.x + fromRect.width / 2,
        cy: fromRect.y + fromRect.height / 2,
        centerX: ow / 2,
        centerY: (oh - bottomInset) / 2,
        k: fromRect.width / cardWidth,
      }
    : null;

  // Scale is uniform and anchored at the element's center, so we translate the
  // center from the cell's center to the screen's center as it grows.
  const transform = start
    ? [
        {
          translateX: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [start.cx - start.centerX, 0],
          }),
        },
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [start.cy - start.centerY, 0],
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
          bottom: bottomInset,
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
