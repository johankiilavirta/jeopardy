export interface SessionAuthority {
  roomId: string;
  epoch: number;
}

export function createRoomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function legacyRoomId(mode: string, roomCode: number): string {
  return `legacy-${mode}-${roomCode}`;
}

export function normalizeEpoch(value: unknown, fallback = 1): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

export function nextEpoch(epoch: number): number {
  return Math.max(1, Math.floor(epoch)) + 1;
}
