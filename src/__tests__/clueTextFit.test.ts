import { describe, expect, it } from 'vitest';
import {
  clueHeightAvailableForReveal,
  clueLineHeight,
  DEFAULT_CLUE_FONT_SIZE,
  MIN_CLUE_FONT_SIZE,
  nextFittedClueFontSize,
} from '../../ui/screens/clueTextFit.js';

describe('clue text fitting', () => {
  it('keeps the existing font size when the clue fits', () => {
    expect(nextFittedClueFontSize(DEFAULT_CLUE_FONT_SIZE, 150, 150)).toBe(26);
    expect(nextFittedClueFontSize(DEFAULT_CLUE_FONT_SIZE, 100, 150)).toBe(26);
  });

  it('shrinks only an overflowing clue', () => {
    expect(nextFittedClueFontSize(DEFAULT_CLUE_FONT_SIZE, 240, 120)).toBe(25);
  });

  it('never shrinks below the readable minimum', () => {
    expect(nextFittedClueFontSize(17, 500, 50)).toBe(MIN_CLUE_FONT_SIZE);
    expect(nextFittedClueFontSize(MIN_CLUE_FONT_SIZE, 500, 50)).toBe(MIN_CLUE_FONT_SIZE);
  });

  it('reserves the answer below a centered clue on both sides of its center', () => {
    expect(clueHeightAvailableForReveal(300, 40)).toBe(164);
  });

  it('keeps line height proportional to the fitted font', () => {
    expect(clueLineHeight(26)).toBe(38);
    expect(clueLineHeight(20)).toBe(29);
  });
});
