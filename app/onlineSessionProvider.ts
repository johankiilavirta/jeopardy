import { WebSocketTransport } from '../src/webSocketTransport';
import type { SessionControlMessage, SessionProvider } from './sessionProvider';
import type { SessionAuthority } from './sessionAuthority';

/** WebSocket relay implementation of the shared room/session lifecycle. */
export class OnlineSessionProvider implements SessionProvider {
  readonly mode = 'online' as const;
  readonly ready: Promise<string>;

  private readonly socket: WebSocketTransport;

  constructor(url: string) {
    this.socket = new WebSocketTransport(url);
    this.ready = this.socket.ready;
  }

  get isClosed(): boolean {
    return this.socket.isClosed;
  }

  createRoom(playerName: string, requestedRoomCode?: number, _authority?: SessionAuthority): void {
    this.socket.sendRaw({
      type: 'create-room',
      playerName,
      ...(requestedRoomCode != null ? { roomCode: requestedRoomCode } : {}),
    });
  }

  joinRoom(roomCode: number, playerName: string, _authority?: SessionAuthority): void {
    this.socket.sendRaw({ type: 'join-room', roomCode, playerName });
  }

  startGame(options: { gameId?: number; resume?: object } = {}): void {
    this.socket.sendRaw({ type: 'start-game', ...options });
  }

  stop(): void {
    this.socket.stop();
  }

  advertise(_displayName: string): void {
    this.socket.advertise();
  }

  discover(): void {
    this.socket.discover();
  }

  send(peerId: string, message: string): void {
    this.socket.send(peerId, message);
  }

  broadcast(message: string): void {
    this.socket.broadcast(message);
  }

  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void {
    this.socket.onPeerConnected(cb);
  }

  onPeerDisconnected(cb: (peerId: string) => void): void {
    this.socket.onPeerDisconnected(cb);
  }

  onMessage(cb: (peerId: string, message: string) => void): void {
    this.socket.onMessage(cb);
  }

  onControlMessage(cb: (message: SessionControlMessage) => void): void {
    this.socket.onRawMessage(message => cb(message as SessionControlMessage));
  }

  onError(cb: (message: string) => void): void {
    this.socket.onError(cb);
  }
}
