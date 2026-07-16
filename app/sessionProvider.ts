import type { Transport } from '../src/transport';

export type SessionControlMessage = Record<string, unknown> & { type: string };

/**
 * Room/lobby lifecycle plus the gameplay message transport it produces.
 * Nearby and online implementations expose this same boundary to the app.
 */
export interface SessionProvider extends Transport {
  readonly mode: 'nearby' | 'online';
  readonly ready: Promise<string>;
  readonly isClosed: boolean;

  createRoom(playerName: string, requestedRoomCode?: number): void;
  joinRoom(roomCode: number, playerName: string): void;
  startGame(options?: { gameId?: number; resume?: object }): void;
  stop(): void;

  onControlMessage(cb: (message: SessionControlMessage) => void): void;
  onError(cb: (message: string) => void): void;
}
