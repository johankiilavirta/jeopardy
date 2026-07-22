/**
 * Shared geometry and timing for the activation lights. The native
 * implementation (ActivationLights.tsx) animates per-lamp opacities through
 * the native driver; the web implementation (ActivationLights.web.tsx)
 * schedules the identical timeline as compositor-run CSS transitions.
 * The numbers live here so the two renditions can never drift apart.
 */

export const LIGHT_COUNT = 171; // High density "electric blue LEDs" // Dense enough for modern look, sparse enough to avoid RN graph limits

/** The band's resting distance above its layer's bottom edge — glued
 *  tightly under the clue card (a subtle 4px gap). Exported so the clue
 *  screen can compute the strip's ride up onto the answer sheet's crown. */
export const LIGHTS_REST_BOTTOM = 38;

/** The buzzer-activation flash runs this long before going steady.
 *  Each of the two pulses takes 120ms (fade-in) + 80ms (hold) + 250ms (fade-out) + 150ms (hold-off) = 600ms.
 *  Then a final fade-in to steady lit takes 120ms.
 *  Total duration = 2 * 600ms + 120ms = 1320ms. */
export const FLASH_MS = 1320;

/** Fully-lit hold before the drain starts for the shared answer window. */
export const HOLD_MS = 1000;

/** Extinguished lamps stay faintly visible, like the real board's dark LEDs. */
export const OFF_OPACITY = 0.15;

/** The strip spans 96% of the clue card, which spans 90% of the screen
 *  (CARD_H_PAD's 5% side insets). */
export const LIGHTS_WIDTH_PCT = 0.96 * 0.9;
