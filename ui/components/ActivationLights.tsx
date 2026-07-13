import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';

const LIGHT_COUNT = 9;
/** One full pulse, matching the broadcast signaling-device loop (~510ms). */
const PULSE_MS = 510;
/** Unlit lights stay faintly visible, like the real board's dark LEDs. */
const DIM = 0.15;

interface ActivationLightsProps {
  /** 'off': clue is still being read — lights sit dark. 'live': buzzers are
   *  open — lights pulse at the broadcast cadence. */
  state: 'off' | 'live';
}

/**
 * The board's activation lights: a sparse row of square LEDs in the dark band
 * under the clue card. On the show these light up the moment the host finishes
 * reading — here they replace the "wait to buzz" text entirely. Dark while
 * reading, pulsing while the buzz window is open.
 */
export function ActivationLights({ state }: ActivationLightsProps) {
  const glow = useRef(new Animated.Value(DIM)).current;

  useEffect(() => {
    if (state !== 'live') {
      glow.setValue(DIM);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.3,
          duration: PULSE_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [state, glow]);

  return (
    <View style={styles.band} pointerEvents="none">
      <View style={styles.row}>
        {Array.from({ length: LIGHT_COUNT }, (_, i) => (
          <Animated.View key={i} style={[styles.light, { opacity: glow }]} />
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
    width: '42%',
    maxWidth: 640,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  light: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.goldBright,
  },
});
