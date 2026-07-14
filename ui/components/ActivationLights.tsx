import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const LIGHT_COUNT = 39; // Dense enough for modern look, sparse enough to avoid RN graph limits
/** The buzzer-activation flash runs this long before going steady.
 *  Each of the two pulses takes 120ms (fade-in) + 80ms (hold) + 250ms (fade-out) + 150ms (hold-off) = 600ms.
 *  Then a final fade-in to steady lit takes 120ms.
 *  Total duration = 2 * 600ms + 120ms = 1320ms. */
const FLASH_MS = 1320;
/** Fully-lit hold before the drain starts (for the personal typing window). */
const HOLD_MS = 1000;
/** Vibrant electric blue, matching the brilliant blue LEDs in the modern set. */
const LIT = '#FFFFFF';
/** Extinguished lamps stay faintly visible, like the real board's dark LEDs. */
const OFF_OPACITY = 0.15;

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
 */
export function ActivationLights({ lights }: ActivationLightsProps) {
  const [activeLights, setActiveLights] = useState<NonNullable<ActivationLightsProps['lights']>>(() => {
    return lights ?? { deadline: 0, durationMs: 1, flash: false };
  });

  const overallOpacity = useRef(new Animated.Value(lights ? 1 : 0)).current;

  useEffect(() => {
    if (lights) {
      setActiveLights(lights);
      Animated.timing(overallOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(overallOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start();
    }
  }, [lights, overallOpacity]);

  const { deadline, durationMs, flash } = activeLights;

  const glow = useRef(new Animated.Value(flash ? OFF_OPACITY : 1)).current;
  /** Fraction of the window elapsed, 0 → 1, advanced linearly to `deadline`. */
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (deadline === 0) return;

    progress.setValue(0);
    glow.setValue(flash ? OFF_OPACITY : 1);

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

    const pop = () => [
      Animated.timing(glow, {
        toValue: 1,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(80),
      Animated.timing(glow, {
        toValue: OFF_OPACITY,
        duration: 250,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(150),
    ];

    const arm = flash
      ? Animated.sequence([
          ...pop(),
          ...pop(),
          Animated.timing(glow, {
            toValue: 1,
            duration: 120,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      : Animated.timing(glow, { toValue: 1, duration: 120, useNativeDriver: true });

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
  const opacities = useMemo(() => {
    const tiers = Math.ceil(LIGHT_COUNT / 2);
    const rangeStart = Math.min(0.9, (flash ? FLASH_MS : HOLD_MS) / durationMs);
    const rangeLen = 1 - rangeStart;
    return Array.from({ length: LIGHT_COUNT }, (_, i) => {
      const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);
      const threshold = rangeStart + (edgeDistance + 1) * (rangeLen / tiers);
      const fadeStart = Math.max(0, threshold - rangeLen / tiers);

      const step = progress.interpolate({
        inputRange: [fadeStart, threshold],
        outputRange: [1, OFF_OPACITY],
        extrapolate: 'clamp',
      });
      return Animated.multiply(glow, step);
    });
  }, [glow, progress, durationMs, flash]);

  return (
    <Animated.View style={[styles.band, { opacity: overallOpacity }]} pointerEvents="none">
      <View style={styles.row}>
        {opacities.map((opacity, i) => (
          <Animated.View key={i} style={[styles.light, { opacity }]} />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 38, // glued tightly to the bottom of the card/grid (leaving a subtle 4px gap)
    alignItems: 'center',
  },
  row: {
    width: '94.08%',
    maxWidth: 1460,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  light: {
    width: 6, // Larger blocks since there are fewer of them
    height: 4,
    borderRadius: 1,
    backgroundColor: LIT, // white LED bulb
    shadowColor: '#0088FF', // electric blue glow
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 3, // glowing halo effect
  },
});
