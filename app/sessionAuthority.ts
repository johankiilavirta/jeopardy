export interface SessionAuthority {
  roomId: string;
  epoch: number;
  leaderId: string;
}

export function createRoomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createLeaderId(): string {
  return `leader-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

export function normalizeLeaderId(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function compareAuthority(a: SessionAuthority, b: SessionAuthority): number {
  if (a.roomId !== b.roomId) return a.roomId > b.roomId ? 1 : -1;
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? 1 : -1;
  if (a.leaderId === b.leaderId) return 0;
  return a.leaderId > b.leaderId ? 1 : -1;
}
