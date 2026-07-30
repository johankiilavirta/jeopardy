/** Round a remaining delay upward to tenths so the display never claims
 *  buzzing is available before the authoritative window actually opens. */
export function revealDelayTenths(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 100);
}

/** Compact countdown copy for the clue screen. */
export function formatRevealDelay(remainingMs: number): string {
  const tenths = revealDelayTenths(remainingMs);
  const seconds = tenths / 10;
  const value = tenths % 10 === 0 ? String(seconds) : seconds.toFixed(1);
  return `BUZZ IN ${value} ${tenths === 10 ? 'SECOND' : 'SECONDS'}`;
}
