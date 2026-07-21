import { describe, expect, it } from 'vitest';
import {
  compareAuthority,
  compareAuthorityClaims,
  normalizeAuthorityStatus,
  type AuthorityClaim,
} from '../../app/sessionAuthority';

const claim = (
  epoch: number,
  status: AuthorityClaim['status'],
  leaderId = 'leader-x',
  roomId = 'room-a',
): AuthorityClaim => ({ roomId, epoch, leaderId, status });

describe('compareAuthorityClaims', () => {
  it('lets a committed host beat a candidate at an identical triple', () => {
    expect(compareAuthorityClaims(claim(1, 'active'), claim(1, 'candidate'))).toBe(1);
    expect(compareAuthorityClaims(claim(1, 'candidate'), claim(1, 'active'))).toBe(-1);
  });

  it('lets epoch dominate status: a higher-epoch candidate beats a committed host', () => {
    expect(compareAuthorityClaims(claim(3, 'candidate'), claim(2, 'active'))).toBe(1);
    expect(compareAuthorityClaims(claim(2, 'active'), claim(3, 'candidate'))).toBe(-1);
  });

  it('lets roomId dominate everything else', () => {
    expect(compareAuthorityClaims(claim(1, 'candidate', 'leader-a', 'room-b'), claim(9, 'active', 'leader-z', 'room-a'))).toBe(1);
  });

  it('breaks equal-epoch equal-status ties on leaderId', () => {
    expect(compareAuthorityClaims(claim(2, 'active', 'leader-z'), claim(2, 'active', 'leader-a'))).toBe(1);
    expect(compareAuthorityClaims(claim(2, 'candidate', 'leader-a'), claim(2, 'candidate', 'leader-z'))).toBe(-1);
    expect(compareAuthorityClaims(claim(2, 'active'), claim(2, 'active'))).toBe(0);
  });

  it('degrades to plain compareAuthority when both sides are committed', () => {
    const pairs: [AuthorityClaim, AuthorityClaim][] = [
      [claim(1, 'active'), claim(2, 'active')],
      [claim(2, 'active', 'leader-a'), claim(2, 'active', 'leader-b')],
      [claim(2, 'active'), claim(2, 'active')],
      [claim(3, 'active', 'leader-a', 'room-b'), claim(2, 'active', 'leader-b', 'room-a')],
    ];
    for (const [a, b] of pairs) {
      expect(compareAuthorityClaims(a, b)).toBe(compareAuthority(a, b));
    }
  });
});

describe('normalizeAuthorityStatus', () => {
  it('passes candidate through and defaults everything else to active', () => {
    expect(normalizeAuthorityStatus('candidate')).toBe('candidate');
    expect(normalizeAuthorityStatus('active')).toBe('active');
    expect(normalizeAuthorityStatus(undefined)).toBe('active');
    expect(normalizeAuthorityStatus(null)).toBe('active');
    expect(normalizeAuthorityStatus('CANDIDATE')).toBe('active');
    expect(normalizeAuthorityStatus(42)).toBe('active');
  });
});
