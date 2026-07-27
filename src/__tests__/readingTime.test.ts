import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeReadingMs } from '../readingTime';

describe('computeReadingMs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts at 4.5 seconds and adds 14ms per character', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeReadingMs('')).toBe(4500);
    expect(computeReadingMs('x'.repeat(50))).toBe(5200);
  });

  it('adds no more than 349ms of jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(computeReadingMs('')).toBe(4849);
  });

  it('caps long clues at 6 seconds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(computeReadingMs('x'.repeat(200))).toBe(6000);
  });
});
