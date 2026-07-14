import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import {
  FLASH_MS,
  HOLD_MS,
  LIGHT_COUNT,
  LIGHTS_REST_BOTTOM,
  OFF_OPACITY,
} from './activationLightsMetrics';

export { LIGHTS_REST_BOTTOM, LIGHTS_WIDTH_PCT } from './activationLightsMetrics';

interface ActivationLightsProps {
  /** The light configurations, or null/undefined to fade out. */
  lights?: {
    deadline: number;
    durationMs: number;
    flash: boolean;
  } | null | undefined;
}

/**
 * The board's activation lights, doubling as the answer timer: a row
 * of electric-blue rectangular LED bars glued tightly under the clue card.
 * When the buzzers open they pop at the broadcast cadence for a second, hold
 * steady, then extinguish linearly from the outermost pair inward until time
 * is up.
 *
 * Memoized: the 171-lamp subtree renders only when the window prop's
 * identity changes (the parent keeps it stable across unrelated renders).
 */
export const ActivationLights = memo(function ActivationLights({ lights }: ActivationLightsProps) {
  const [activeLights, setActiveLights] = useState<NonNullable<ActivationLightsProps['lights']>>(() => {
    return lights ?? { deadline: 0, durationMs: 1, flash: false };
  });

  const overallOpacity = useRef(new Animated.Value(lights ? 1 : 0)).current;

  const glow = useRef(new Animated.Value(lights?.flash ? OFF_OPACITY : 1)).current;
  /** Fraction of the window elapsed, 0 → 1, advanced linearly to `deadline`. */
  const progress = useRef(new Animated.Value(0)).current;

  // Compare the window by value, not object identity: parents rebuild the
  // prop object every render, and a spurious "new window" here would reset
  // the glow to its off state with no arm effect re-run to re-light it.
  const lightsKey = lights ? `${lights.deadline}/${lights.durationMs}/${lights.flash}` : null;
  const prevLightsKeyRef = useRef(lightsKey);
  if (lightsKey !== prevLightsKeyRef.current) {
    if (lights) {
      setActiveLights(lights);
      // Synchronously reset animated values before React commits the first frame to the screen!
      progress.setValue(0);
      glow.setValue(lights.flash ? OFF_OPACITY : 1);

      Animated.timing(overallOpacity, {
        toValue: 1,
        duration: 100, // Twice as fast fade-in
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(overallOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
    prevLightsKeyRef.current = lightsKey;
  }

  const { deadline, durationMs, flash } = activeLights;

  useEffect(() => {
    if (deadline === 0) return;

    let drain: Animated.CompositeAnimation | null = null;
    const startDrain = () => {
      // Measured at drain start (after the hold), so the strip empties
      // exactly at the deadline rather than a hold-length late.
      const remaining = Math.max(0, deadline - Date.now());
      
      // Start exactly at rangeStart so no lights snap off instantly if there was network delay!
      const rangeStart = Math.min(0.9, (flash ? FLASH_MS : HOLD_MS) / durationMs);
      progress.setValue(rangeStart);
      
      drain = Animated.timing(progress, {
        toValue: 1,
        duration: remaining,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      drain.start();
    };

    const arm = flash
      ? Animated.sequence([
          Animated.timing(glow, {
            toValue: 1,
            duration: 60, // Twice as fast flash
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(1260), // Preserves exactly 1320ms FLASH_MS
        ])
      : Animated.timing(glow, { toValue: 1, duration: 60, useNativeDriver: true });

    arm.start(({ finished }) => {
      if (finished) startDrain();
    });

    return () => {
      arm.stop();
      drain?.stop();
    };
  }, [glow, progress, deadline, durationMs, flash]);

  // Each lamp extinguishes when the elapsed fraction passes its threshold.
  // Outermost pair first, center last. The countdown range begins where the
  // hold ends (as a fraction of the whole window), so every lamp gets a turn
  // and the center lamp dies exactly at the deadline.
  const tierOpacities = useMemo(() => {
    const tiers = Math.ceil(LIGHT_COUNT / 2);
    const rangeStart = Math.min(0.9, (flash ? FLASH_MS : HOLD_MS) / durationMs);
    const rangeLen = 1 - rangeStart;
    
    // Create exactly `tiers` animated nodes (one for each distance from the edge)
    return Array.from({ length: tiers }, (_, d) => {
      const threshold = rangeStart + (d + 1) * (rangeLen / tiers);
      const fadeStart = Math.max(0, threshold - rangeLen / tiers);

      return progress.interpolate({
        inputRange: [fadeStart, threshold],
        outputRange: [1, OFF_OPACITY],
        extrapolate: 'clamp',
      });
    });
  }, [progress, durationMs, flash]);

  return (
    <Animated.View style={[styles.band, { opacity: overallOpacity }]} pointerEvents="none">
      <Animated.View style={[styles.row, { opacity: glow }]}>
        {Array.from({ length: LIGHT_COUNT }).map((_, i) => {
          const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
          return (
            <Animated.View key={i} style={[styles.light, { opacity: tierOpacities[edgeDistance] }]} />
          );
        })}
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: LIGHTS_REST_BOTTOM,
    alignItems: 'center',
  },
  row: {
    width: '86.4%', // LIGHTS_WIDTH_PCT
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  light: {
    width: 2, // 2px square blocks
    height: 2,
    borderRadius: 0, // perfectly square like in the gif
    backgroundColor: '#FFFFFF', // The physical LED color when lit
    shadowColor: '#0088FF', // electric blue glow
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3, // glowing halo effect
  },
});
