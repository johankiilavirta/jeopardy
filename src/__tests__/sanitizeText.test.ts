import { describe, expect, it } from 'vitest';
import { sanitizeText } from '../sanitizeText.js';

describe('sanitizeText', () => {
  it('decodes literal quote, slash, and unicode escapes from source data', () => {
    expect(sanitizeText('THE \\"A\\" \\u2014 B\\/C')).toBe('THE "A" — B/C');
  });

  it('handles doubly escaped source text and normalizes its whitespace', () => {
    expect(sanitizeText('\\\\"HELLO\\\\"  \\n WORLD')).toBe('"HELLO"\nWORLD');
  });

  it('leaves ordinary display text alone', () => {
    expect(sanitizeText('What is déjà vu?')).toBe('What is déjà vu?');
  });
});
