import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import { BuzzHaptics } from 'nearby-network';

/**
 * Produce a deliberately noticeable "buzzers are open" cue.
 *
 * iOS maps notification feedback directly to its Taptic Engine. The generic
 * React Native Vibration API is kept as a fallback for platforms where the
 * native haptics call is unavailable.
 */
export async function triggerBuzzFeedback(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      if (BuzzHaptics?.buzz()) return;
      // A single notification pulse is easy to miss on a phone resting in a
      // hand or on a table. Three deliberate impacts read as an actual buzzer
      // cue while remaining short enough not to delay play.
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await pause(110);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      await pause(110);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    Vibration.vibrate();
  }
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
