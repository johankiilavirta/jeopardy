const BASE_MS = 5000;
const PER_CHAR_MS = 40;
const MAX_NOISE_MS = 500;
const CAP_MS = 9000;

/** How long to wait before opening the buzz window for a given clue text.
 *  5s base + 40ms/char + up to 500ms of jitter, capped at 9s. */
export function computeReadingMs(text: string): number {
  const noise = Math.floor(Math.random() * MAX_NOISE_MS);
  return Math.min(CAP_MS, BASE_MS + Math.floor(text.length * PER_CHAR_MS) + noise);
}
