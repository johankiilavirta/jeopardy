const BASE_MS = 4500;
const PER_CHAR_MS = 14;
const MAX_NOISE_MS = 350;
const CAP_MS = 6000;

/** How long to wait before opening the buzz window for a given clue text.
 *  4.5s base + 14ms/char + up to 350ms of jitter, capped at 6s. */
export function computeReadingMs(text: string): number {
  const noise = Math.floor(Math.random() * MAX_NOISE_MS);
  return Math.min(CAP_MS, BASE_MS + Math.floor(text.length * PER_CHAR_MS) + noise);
}
