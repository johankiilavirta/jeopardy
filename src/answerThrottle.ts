/**
 * Leading+trailing throttle for answer keystrokes.
 *
 * Every keystroke used to send a SET_ANSWER over the wire; on slow
 * transports (Bluetooth) that floods the send queue. Each update carries
 * the *full* current text (not a diff), so intermediate sends are safely
 * skippable: the first keystroke sends immediately (leading), and while
 * the interval is running only the newest text is kept, going out when
 * the interval elapses (trailing).
 *
 * Known trade-off: if the server-side typing timer locks the answer (a
 * LOCK_ANSWER without text — the last synced answer stands), the final
 * <intervalMs of typing may be lost. A user-initiated lock is unaffected
 * because LOCK_ANSWER carries the full text.
 */
export interface KeystrokeThrottle {
  /** Record the latest text; sends now (leading) or after the interval (trailing). */
  update(text: string): void;
  /** Send any pending trailing text immediately and stop the interval. */
  flush(): void;
  /** Drop any pending trailing text and stop the interval. */
  cancel(): void;
}

export function createKeystrokeThrottle(
  send: (text: string) => void,
  intervalMs = 250,
): KeystrokeThrottle {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;

  function startInterval(): void {
    timerId = setTimeout(() => {
      timerId = null;
      if (pending != null) {
        const text = pending;
        pending = null;
        send(text);
        startInterval();
      }
    }, intervalMs);
  }

  return {
    update(text: string): void {
      if (timerId == null) {
        send(text);
        startInterval();
      } else {
        pending = text;
      }
    },
    flush(): void {
      if (timerId != null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (pending != null) {
        const text = pending;
        pending = null;
        send(text);
      }
    },
    cancel(): void {
      if (timerId != null) {
        clearTimeout(timerId);
        timerId = null;
      }
      pending = null;
    },
  };
}
