import type { Transport } from '../src/transport';
import type { SessionAuthority } from './sessionAuthority';

export type SessionControlMessage = Record<string, unknown> & { type: string };
export type SessionMode = 'bluetooth' | 'nearby' | 'online';

/**
 * Room/lobby lifecycle plus the gameplay message transport it produces.
 * Nearby and online implementations expose this same boundary to the app.
 */
export interface SessionProvider extends Transport {
  readonly mode: SessionMode;
  readonly ready: Promise<string>;
  readonly isClosed: boolean;

  createRoom(playerName: string, requestedRoomCode?: number, authority?: SessionAuthority, options?: { candidate?: boolean }): void;
  joinRoom(roomCode: number, playerName: string, authority?: SessionAuthority): void;
  startGame(options?: { gameId?: number; resume?: object }): void;
  stop(): void;

  onControlMessage(cb: (message: SessionControlMessage) => void): void;
  onError(cb: (message: string) => void): void;
}
