import { describe, expect, it } from 'vitest';
import { connectionModeForRoomCode } from '../../app/roomCodes';

describe('connectionModeForRoomCode', () => {
  it('routes 100–499 to nearby sessions', () => {
    expect(connectionModeForRoomCode(100)).toBe('nearby');
    expect(connectionModeForRoomCode(274)).toBe('nearby');
    expect(connectionModeForRoomCode(499)).toBe('nearby');
  });

  it('routes 500–999 to online sessions', () => {
    expect(connectionModeForRoomCode(500)).toBe('online');
    expect(connectionModeForRoomCode(682)).toBe('online');
    expect(connectionModeForRoomCode(999)).toBe('online');
  });

  it('rejects reserved and malformed codes', () => {
    expect(connectionModeForRoomCode(99)).toBeNull();
    expect(connectionModeForRoomCode(1000)).toBeNull();
    expect(connectionModeForRoomCode(682.5)).toBeNull();
    expect(connectionModeForRoomCode(Number.NaN)).toBeNull();
  });
});
