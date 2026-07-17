export type ConnectionMode = 'nearby' | 'online';

export const NEARBY_ROOM_MIN = 100;
export const NEARBY_ROOM_MAX = 499;
export const ONLINE_ROOM_MIN = 500;
export const ONLINE_ROOM_MAX = 999;

/** The first digit routes a room code without probing both transports. */
export function connectionModeForRoomCode(roomCode: number): ConnectionMode | null {
  if (!Number.isInteger(roomCode)) return null;
  if (roomCode >= NEARBY_ROOM_MIN && roomCode <= NEARBY_ROOM_MAX) return 'nearby';
  if (roomCode >= ONLINE_ROOM_MIN && roomCode <= ONLINE_ROOM_MAX) return 'online';
  return null;
}

