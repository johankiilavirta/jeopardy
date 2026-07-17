import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';

interface UndoRedoSwipeProps {
  children: React.ReactNode;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Suppress the arrow-key shortcuts while another surface owns the arrow
   *  keys (e.g. the judgement tray's verdict keys). Swipes stay active. */
  arrowKeysDisabled?: boolean;
}

const ICON_SIZE = 48;
const COMMIT_DISTANCE = 80;
const COMMIT_VELOCITY = 0.5;
const COMMIT_DISTANCE_FAST = 40;

export function UndoRedoSwipe({
  children,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  arrowKeysDisabled,
}: UndoRedoSwipeProps) {
  const dragX = useRef(new Animated.Value(0)).current;
  const dxRef = useRef(0);
  const directionRef = useRef<'left' | 'right' | null>(null);

  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const canRedoRef = useRef(canRedo);
  canRedoRef.current = canRedo;

  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;

  const arrowKeysDisabledRef = useRef(arrowKeysDisabled);
  arrowKeysDisabledRef.current = arrowKeysDisabled;

  // Web keyboard shortcuts: swipes are awkward with a mouse, so the arrow
  // keys mirror the gestures (left = undo, right = redo).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      if (arrowKeysDisabledRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && canUndoRef.current) {
        e.preventDefault();
        onUndoRef.current();
      } else if (e.key === 'ArrowRight' && canRedoRef.current) {
        e.preventDefault();
        onRedoRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const springBack = () => {
    directionRef.current = null;
    dxRef.current = 0;
    Animated.spring(dragX, {
      toValue: 0,
      speed: 14,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => {
          const dominated = Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
          if (!dominated) return false;
          // Swipe right pulls undo in from the left edge (like iOS back);
          // swipe left pulls redo in from the right edge.
          if (g.dx > 0 && !canUndoRef.current) return false;
          if (g.dx < 0 && !canRedoRef.current) return false;
          return true;
        },
        onPanResponderGrant: () => {
          // gestureState.dx is reset to 0 on grant, so the direction can
          // only be determined from the first real move event.
          directionRef.current = null;
          dxRef.current = 0;
        },
        onPanResponderMove: (_e, g) => {
          if (directionRef.current == null && g.dx !== 0) {
            directionRef.current = g.dx < 0 ? 'left' : 'right';
          }
          const dir = directionRef.current;
          let dx = g.dx;
          if (dir === 'left' && dx > 0) dx = 0;
          if (dir === 'right' && dx < 0) dx = 0;

          const abs = Math.abs(dx);
          const sign = dx < 0 ? -1 : 1;
          const clamped =
            abs <= COMMIT_DISTANCE
              ? abs
              : COMMIT_DISTANCE + (abs - COMMIT_DISTANCE) * 0.12;
          dxRef.current = sign * clamped;
          dragX.setValue(sign * clamped);
        },
        onPanResponderRelease: (_e, g) => {
          const abs = Math.abs(dxRef.current);
          const committed =
            abs >= COMMIT_DISTANCE ||
            (abs >= COMMIT_DISTANCE_FAST && Math.abs(g.vx) >= COMMIT_VELOCITY);

          if (committed) {
            const dir = directionRef.current;
            if (dir === 'right' && canUndoRef.current) onUndoRef.current();
            if (dir === 'left' && canRedoRef.current) onRedoRef.current();
          }
          springBack();
        },
        onPanResponderTerminate: () => {
          springBack();
        },
      }),
    [dragX],
  );

  // Undo icon: starts off-screen left, slides in when swiping right
  const undoTranslateX = dragX.interpolate({
    inputRange: [0, COMMIT_DISTANCE],
    outputRange: [-(ICON_SIZE + 20), 0],
    extrapolate: 'clamp',
  });
  const undoOpacity = dragX.interpolate({
    inputRange: [0, 20, COMMIT_DISTANCE],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });

  // Redo icon: starts off-screen right, slides in when swiping left
  const redoTranslateX = dragX.interpolate({
    inputRange: [-COMMIT_DISTANCE, 0],
    outputRange: [0, ICON_SIZE + 20],
    extrapolate: 'clamp',
  });
  const redoOpacity = dragX.interpolate({
    inputRange: [-COMMIT_DISTANCE, -20, 0],
    outputRange: [1, 0.4, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root} {...panResponder.panHandlers}>
      {children}

      {canUndo && (
        <Animated.View
          style={[
            styles.iconWrap,
            styles.iconLeft,
            { opacity: undoOpacity, transform: [{ translateX: undoTranslateX }] },
          ]}
          pointerEvents="none"
        >
          <Chevron direction="left" />
        </Animated.View>
      )}

      {canRedo && (
        <Animated.View
          style={[
            styles.iconWrap,
            styles.iconRight,
            { opacity: redoOpacity, transform: [{ translateX: redoTranslateX }] },
          ]}
          pointerEvents="none"
        >
          <Chevron direction="right" />
        </Animated.View>
      )}
    </View>
  );
}

/** Stroke-built chevron matching the judgement tray's glyph style. */
function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <View
      style={[styles.glyph, direction === 'right' && styles.glyphFlipped]}
    >
      <View style={[styles.chevStroke, styles.chevTop]} />
      <View style={[styles.chevStroke, styles.chevBottom]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  iconWrap: {
    position: 'absolute',
    top: '45%',
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: colors.cellRecessed,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconRight: {
    right: 8,
  },
  iconLeft: {
    left: 8,
  },
  glyph: {
    width: 24,
    height: 24,
    overflow: 'visible',
  },
  glyphFlipped: {
    transform: [{ scaleX: -1 }],
  },
  // Same stroke treatment as the judgement tray's ✕/✓ marks.
  chevStroke: {
    position: 'absolute',
    width: 14,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  chevTop: {
    left: 4,
    top: 5.25,
    transform: [{ rotate: '-45deg' }],
  },
  chevBottom: {
    left: 4,
    top: 15.25,
    transform: [{ rotate: '45deg' }],
  },
});
