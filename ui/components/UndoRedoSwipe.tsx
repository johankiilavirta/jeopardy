import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

interface UndoRedoSwipeProps {
  children: React.ReactNode;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
}

const COMMIT_DISTANCE = 80;
const COMMIT_VELOCITY = 0.5;
const COMMIT_DISTANCE_FAST = 40;
const ICON_MAX_OFFSET = 40;

export function UndoRedoSwipe({
  children,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  disabled,
}: UndoRedoSwipeProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const dxRef = useRef(0);
  const directionRef = useRef<'left' | 'right' | null>(null);

  // Use refs so the PanResponder (created once) always reads fresh prop values
  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const canRedoRef = useRef(canRedo);
  canRedoRef.current = canRedo;
  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => {
          if (disabledRef.current) return false;
          const dominated = Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
          if (!dominated) return false;
          if (g.dx < 0 && !canUndoRef.current) return false;
          if (g.dx > 0 && !canRedoRef.current) return false;
          return true;
        },
        onPanResponderGrant: (_e, g) => {
          directionRef.current = g.dx < 0 ? 'left' : g.dx > 0 ? 'right' : null;
          dxRef.current = 0;
        },
        onPanResponderMove: (_e, g) => {
          const dir = directionRef.current;
          let dx = g.dx;
          if (dir === 'left' && dx > 0) dx = 0;
          if (dir === 'right' && dx < 0) dx = 0;

          const abs = Math.abs(dx);
          const sign = dx < 0 ? -1 : 1;
          const clamped =
            abs <= COMMIT_DISTANCE
              ? abs
              : COMMIT_DISTANCE + (abs - COMMIT_DISTANCE) * 0.2;
          dxRef.current = sign * clamped;
          translateX.setValue(sign * clamped);
        },
        onPanResponderRelease: (_e, g) => {
          const abs = Math.abs(dxRef.current);
          const committed =
            abs >= COMMIT_DISTANCE ||
            (abs >= COMMIT_DISTANCE_FAST && Math.abs(g.vx) >= COMMIT_VELOCITY);

          if (committed) {
            const dir = directionRef.current;
            if (dir === 'left') onUndoRef.current();
            if (dir === 'right') onRedoRef.current();
          }

          directionRef.current = null;
          dxRef.current = 0;
          Animated.spring(translateX, {
            toValue: 0,
            speed: 14,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          directionRef.current = null;
          dxRef.current = 0;
          Animated.spring(translateX, {
            toValue: 0,
            speed: 14,
            bounciness: 4,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateX],
  );

  const undoIconOpacity = translateX.interpolate({
    inputRange: [-COMMIT_DISTANCE, -20, 0],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });
  const undoIconTranslate = translateX.interpolate({
    inputRange: [-COMMIT_DISTANCE, 0],
    outputRange: [-ICON_MAX_OFFSET, 0],
    extrapolate: 'clamp',
  });

  const redoIconOpacity = translateX.interpolate({
    inputRange: [0, 20, COMMIT_DISTANCE],
    outputRange: [0, 0.3, 1],
    extrapolate: 'clamp',
  });
  const redoIconTranslate = translateX.interpolate({
    inputRange: [0, COMMIT_DISTANCE],
    outputRange: [0, ICON_MAX_OFFSET],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      {canUndo && (
        <Animated.View
          style={[
            styles.icon,
            styles.iconRight,
            { opacity: undoIconOpacity, transform: [{ translateX: undoIconTranslate }] },
          ]}
        >
          <Text style={styles.iconText}>{'\u21A9'}</Text>
        </Animated.View>
      )}

      {canRedo && (
        <Animated.View
          style={[
            styles.icon,
            styles.iconLeft,
            { opacity: redoIconOpacity, transform: [{ translateX: redoIconTranslate }] },
          ]}
        >
          <Text style={styles.iconText}>{'\u21AA'}</Text>
        </Animated.View>
      )}

      <Animated.View
        style={[styles.content, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  icon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: -1,
  },
  iconRight: {
    right: 0,
  },
  iconLeft: {
    left: 0,
  },
  iconText: {
    fontSize: 32,
    color: 'rgba(255,255,255,0.8)',
  },
});
