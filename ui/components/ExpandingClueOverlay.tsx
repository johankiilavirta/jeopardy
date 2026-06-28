import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { CellRect } from './BoardCell';

/** Expand duration, board cell → full screen. */
const EXPAND_MS = 280;

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
  const [start, setStart] = useState<{ tx: number; ty: number; sx: number; sy: number } | null>(null);
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
      setStart({
        tx: fromRect.x - ox,
        ty: fromRect.y - oy,
        sx: fromRect.width / ow,
        sy: fromRect.height / oh,
      });
      setReady(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: EXPAND_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [willAnimate, fromRect, progress]);

  const transform = start
    ? [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [start.tx, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [start.ty, 0] }) },
        { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [start.sx, 1] }) },
        { scaleY: progress.interpolate({ inputRange: [0, 1], outputRange: [start.sy, 1] }) },
      ]
    : [];

  return (
    <Animated.View
      ref={containerRef}
      onLayout={begin}
      // transformOrigin keeps the scale anchored at the top-left corner, so the
      // translate lines the card up with the cell exactly.
      style={[styles.fill, { transformOrigin: 'left top', transform, opacity: ready ? 1 : 0 }]}
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
