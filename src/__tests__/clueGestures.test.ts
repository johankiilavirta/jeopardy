import { describe, expect, it } from 'vitest';
import {
  shouldCommitSkip,
  verticalClueGesture,
} from '../../ui/screens/clueGestures.js';

describe('vertical clue gestures', () => {
  it('gives a visible keyboard first claim on every downward drag', () => {
    expect(verticalClueGesture(2, 40, {
      keyboardVisible: true,
      canSkip: true,
      canSummon: true,
    })).toBe('keyboard-dismiss');
  });

  it('uses downward drag for skip only when the keyboard is closed', () => {
    expect(verticalClueGesture(2, 40, {
      keyboardVisible: false,
      canSkip: true,
      canSummon: true,
    })).toBe('skip');
  });

  it('never summons a keyboard from a downward drag', () => {
    expect(verticalClueGesture(2, 40, {
      keyboardVisible: false,
      canSkip: false,
      canSummon: true,
    })).toBeNull();
  });

  it('reserves upward drag for buzz, summon, or unlock', () => {
    expect(verticalClueGesture(2, -40, {
      keyboardVisible: false,
      canSkip: true,
      canSummon: true,
    })).toBe('summon');
  });

  it('commits skip on release only after the full pull distance', () => {
    expect(shouldCommitSkip(119.9)).toBe(false);
    expect(shouldCommitSkip(120)).toBe(true);
  });

  it('invalidates a fully pulled skip when the keyboard opens', () => {
    expect(shouldCommitSkip(120, true)).toBe(false);
  });
});
