import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const LIGHT_COUNT = 13;
/** The buzzer-activation flash runs this long before going steady. */
const FLASH_MS = 1000;
/** From the broadcast gif: each ~510ms cycle the lamps pop on for ~90ms. */
const POP_ON_MS = 90;
const POP_OFF_MS = 420;
/** Warm incandescent white, sampled from the gif's lit lamps. */
const LIT = '#F7EFE8';
/** Extinguished lamps stay faintly visible, like the real board's dark LEDs. */
const OFF_OPACITY = 0.15;

interface ActivationLightsProps {
  /** Epoch ms when the answer window closes — the strip drains to empty here. */
  deadline: number;
  /** The window's full length, so a mid-window mount starts partially drained. */
  durationMs: number;
  /** Pop twice (the activation moment) before going steady. False when the
   *  strip is re-armed for a personal typing timer — no re-activation. */
  flash: boolean;
}

/**
 * The board's activation lights, doubling as the answer timer: a sparse row
 * of warm-white lamps in the dark band under the clue card. When the buzzers
 * open they pop at the broadcast cadence for a second, hold steady, then
 * extinguish linearly from the outermost pair inward until time is up —
 * the show's podium countdown, laid flat.
 *
 * Mount keyed by `deadline` so a new window re-runs the animations.
 */
export function ActivationLights({ deadline, durationMs, flash }: ActivationLightsProps) {
  const glow = useRef(new Animated.Value(flash ? OFF_OPACITY : 1)).current;
  /** Fraction of the window elapsed, 0 → 1, advanced linearly to `deadline`. */
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pop = () => [
      Animated.timing(glow, { toValue: 1, duration: 30, useNativeDriver: true }),
      Animated.delay(POP_ON_MS - 30),
      Animated.timing(glow, { toValue: OFF_OPACITY, duration: 30, useNativeDriver: true }),
      Animated.delay(POP_OFF_MS - 60),
    ];
    const arm = flash
      ? Animated.sequence([...pop(), ...pop(), Animated.timing(glow, { toValue: 1, duration: 30, useNativeDriver: true })])
      : Animated.timing(glow, { toValue: 1, duration: 120, useNativeDriver: true });
    arm.start();

    const remaining = Math.max(0, deadline - Date.now());
    progress.setValue(1 - remaining / durationMs);
    const drain = Animated.timing(progress, {
      toValue: 1,
      duration: remaining,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    drain.start();
    return () => {
      arm.stop();
      drain.stop();
    };
  }, [glow, progress, deadline, durationMs, flash]);

  // Each lamp extinguishes when the elapsed fraction passes its threshold.
  // Outermost pair first, center last; thresholds spread evenly across the
  // window (skipping the flash second, during which everything stays lit).
  const opacities = useMemo(() => {
    const tiers = Math.ceil(LIGHT_COUNT / 2);
    const drainStart = flash ? Math.min(0.9, FLASH_MS / durationMs) : 0;
    return Array.from({ length: LIGHT_COUNT }, (_, i) => {
      const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
      const threshold = drainStart + (1 - drainStart) * ((edgeDistance + 1) / tiers);
      const step = progress.interpolate({
        inputRange: [Math.max(0, threshold - 0.03), threshold],
        outputRange: [1, OFF_OPACITY],
        extrapolate: 'clamp',
      });
      return Animated.multiply(glow, step);
    });
  }, [glow, progress, durationMs, flash]);

  return (
    <View style={styles.band} pointerEvents="none">
      <View style={styles.row}>
        {opacities.map((opacity, i) => (
          <Animated.View key={i} style={[styles.light, { opacity }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Vertically centered in the card's 44px bottom-margin band.
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
  },
  // A happy medium: the strip spans well short of the full card width.
  row: {
    width: '48%',
    maxWidth: 780,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  light: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: LIT,
  },
});
