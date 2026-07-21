import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKeystrokeThrottle } from '../answerThrottle.js';

describe('createKeystrokeThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the first update immediately (leading edge)', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('a');
  });

  it('coalesces updates within the interval into one trailing send of the latest text', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    throttle.update('ab');
    throttle.update('abc');
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('abc');
  });

  it('chains trailing sends while typing continues', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');          // leading
    throttle.update('ab');
    vi.advanceTimersByTime(250);   // trailing 'ab', interval restarts
    throttle.update('abc');
    throttle.update('abcd');
    vi.advanceTimersByTime(250);   // trailing 'abcd'
    expect(send.mock.calls.map(c => c[0])).toEqual(['a', 'ab', 'abcd']);
  });

  it('sends leading again after an idle interval with no pending text', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    vi.advanceTimersByTime(250);   // interval elapses, nothing pending
    throttle.update('ab');         // fresh leading send
    expect(send.mock.calls.map(c => c[0])).toEqual(['a', 'ab']);
  });

  it('flush sends pending text immediately and stops the interval', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    throttle.update('ab');
    throttle.flush();
    expect(send.mock.calls.map(c => c[0])).toEqual(['a', 'ab']);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('flush with nothing pending sends nothing', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    vi.advanceTimersByTime(250);
    throttle.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cancel drops pending text and stops the interval', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send, 250);
    throttle.update('a');
    throttle.update('ab');
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    // Next update is a fresh leading send.
    throttle.update('x');
    expect(send).toHaveBeenLastCalledWith('x');
  });

  it('uses the default 250ms interval', () => {
    const send = vi.fn();
    const throttle = createKeystrokeThrottle(send);
    throttle.update('a');
    throttle.update('ab');
    vi.advanceTimersByTime(249);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
