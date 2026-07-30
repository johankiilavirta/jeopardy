import { describe, expect, it } from 'vitest';
import { formatRevealDelay, revealDelayTenths } from '../revealDelay.js';

describe('reveal delay countdown', () => {
  it('rounds upward to tenths without showing an early zero', () => {
    expect(revealDelayTenths(5300)).toBe(53);
    expect(revealDelayTenths(5201)).toBe(53);
    expect(revealDelayTenths(1)).toBe(1);
    expect(revealDelayTenths(0)).toBe(0);
  });

  it('uses compact copy with at most one decimal place', () => {
    expect(formatRevealDelay(5300)).toBe('BUZZ IN 5.3 SECONDS');
    expect(formatRevealDelay(5000)).toBe('BUZZ IN 5 SECONDS');
    expect(formatRevealDelay(1000)).toBe('BUZZ IN 1 SECOND');
    expect(formatRevealDelay(0)).toBe('BUZZ IN 0 SECONDS');
  });
});
