import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

const LIGHT_COUNT = 13;
/** The buzzer-activation flash runs this long before going steady.
 *  Each of the two pulses takes 120ms (fade-in) + 80ms (hold) + 250ms (fade-out) + 150ms (hold-off) = 600ms.
 *  Then a final fade-in to steady lit takes 120ms.
 *  Total duration = 2 * 600ms + 120ms = 1320ms. */
const FLASH_MS = 1320;
/** Warm incandescent white, sampled from the gif's lit lamps. */
const LIT = '#F7EFE8';
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
 * The board's activation lights, doubling as the answer timer: a sparse row
 * of warm-white lamps in the dark band under the clue card. When the buzzers
 * open they pop at the broadcast cadence for a second, hold steady, then
 * extinguish linearly from the outermost pair inward until time is up —
 * the show's podium countdown, laid flat.
 *
 * It stays mounted and animates its overall opacity when lights are cleared.
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

    glow.setValue(flash ? OFF_OPACITY : 1);

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
  // Outermost pair first, center last.
  const opacities = useMemo(() => {
    const tiers = Math.ceil(LIGHT_COUNT / 2);
    return Array.from({ length: LIGHT_COUNT }, (_, i) => {
      const edgeDistance = Math.min(i, LIGHT_COUNT - 1 - i);

      let threshold: number;
      let fadeStart: number;

      if (flash) {
        // For the buzz window (8s):
        // Tier d (0 to 6) is fully off at progress = 0.4 + d * 0.1
        // and starts fading at progress = 0.35 + d * 0.1
        threshold = 0.4 + edgeDistance * 0.1;
        fadeStart = 0.35 + edgeDistance * 0.1;
      } else {
        // For the personal typing window (10s):
        // Tier d (0 to 6) is fully off at progress = (d + 1) / tiers
        // and starts fading 0.05 before that.
        threshold = (edgeDistance + 1) / tiers;
        fadeStart = Math.max(0, threshold - 0.05);
      }

      const step = progress.interpolate({
        inputRange: [fadeStart, threshold],
        outputRange: [1, OFF_OPACITY],
        extrapolate: 'clamp',
      });
      return Animated.multiply(glow, step);
    });
  }, [glow, progress, flash]);

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
  // Vertically centered in the card's 44px bottom-margin band.
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
  },
  // Spans 75% of the card width up to 1200px max.
  row: {
    width: '75%',
    maxWidth: 1200,
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
