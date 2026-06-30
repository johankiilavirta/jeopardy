import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { CellRect } from './BoardCell';

/** Expand duration, board cell → full screen. */
const EXPAND_MS = 250;

interface ExpandingClueOverlayProps {
  /** The tapped grid cell's rect in window coords — the card grows from here.
   *  Null (e.g. a clue another player picked) means no animation. */
  fromRect: CellRect | null;
  /** When false, the overlay just fills the screen instantly. */
  animate: boolean;
  children: ReactNode;
}

/**
 * Full-screen overlay for the active clue. When `animate` and a `fromRect` are
 * given, the overlay starts scaled + translated to sit exactly over the tapped
 * board cell, then grows to fill the screen — so the clue card looks like it
 * expands straight out of the grid. We measure the overlay's own window
 * position and subtract it from the cell rect, so the math is correct under any
 * safe-area inset. Mount this keyed by clue id so each pick replays the grow.
 */
export function ExpandingClueOverlay({ fromRect, animate, children }: ExpandingClueOverlayProps) {
  const willAnimate = animate && !!fromRect;
  const progress = useRef(new Animated.Value(willAnimate ? 0 : 1)).current;
  // The card grows uniformly (single scale, so the clue text never distorts)
  // out of the tapped cell's center: at progress 0 it's a small box of scale
  // `k` centered on the cell; at progress 1 it's full-screen and centered.
  const [start, setStart] = useState<{
    cx: number; // cell center, in overlay-local coords
    cy: number;
    centerX: number; // overlay center (full-screen target)
    centerY: number;
    k: number; // uniform start scale
  } | null>(null);
  // Hidden for the first frame(s) while we measure, so the full-screen card
  // never flashes before it snaps down to the cell.
  const [ready, setReady] = useState(!willAnimate);
  const containerRef = useRef<View>(null);
  const startedRef = useRef(false);

  const begin = useCallback(() => {
    if (startedRef.current || !willAnimate || !fromRect) return;
    startedRef.current = true;
    const node = containerRef.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      setReady(true);
      progress.setValue(1);
      return;
    }
    node.measureInWindow((ox, oy, ow, oh) => {
      if (!ow || !oh) {
        setReady(true);
        progress.setValue(1);
        return;
      }
      // Uniform start scale: the larger of the two cell/screen ratios, so the
      // initial box fully covers the tapped cell (no edge of the old grid peeks
      // through) while keeping the screen's aspect ratio — hence no stretch.
      const k = Math.max(fromRect.width / ow, fromRect.height / oh);
      setStart({
        cx: fromRect.x - ox + fromRect.width / 2,
        cy: fromRect.y - oy + fromRect.height / 2,
        centerX: ow / 2,
        centerY: oh / 2,
        k,
      });
      setReady(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: EXPAND_MS,
        // Linear: the box grows at a constant rate, matching the broadcast.
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    });
  }, [willAnimate, fromRect, progress]);

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
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [start.k, 1] }) },
      ]
    : [];

  return (
    <Animated.View
      ref={containerRef}
      onLayout={begin}
      // Scale is anchored at the element's center; the translate then glides
      // that center from the tapped cell to the middle of the screen.
      style={[styles.fill, { transformOrigin: 'center', transform, opacity: ready ? 1 : 0 }]}
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
