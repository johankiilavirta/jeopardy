import type { WebSocket } from 'ws';
import type { Transport } from '../src/transport.js';

// --- Room types ---

export interface RoomPlayer {
  peerId: string;
  name: string;
  ws: WebSocket;
}

export interface Room {
  code: number;
  hostPeerId: string;
  players: RoomPlayer[];
  phase: 'lobby' | 'playing';
  serverTransport?: RoomServerTransport;
}

// --- In-process server transport (no loopback WS) ---

export class RoomServerTransport implements Transport {
  private connectCbs: ((peerId: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];

  constructor(private room: Room) {}

  advertise(): void {}
  discover(): void {}
  stop(): void {}

  /** Called by relay when a game-phase message arrives from a client. */
  deliverMessage(peerId: string, payload: string): void {
    this.messageCbs.forEach(cb => cb(peerId, payload));
  }

  /** Called by relay when a peer connects (game already started). */
  notifyConnect(peerId: string): void {
    this.connectCbs.forEach(cb => cb(peerId));
  }

  /** Called by relay when a peer disconnects during game phase. */
  notifyDisconnect(peerId: string): void {
    this.disconnectCbs.forEach(cb => cb(peerId));
  }

  send(peerId: string, message: string): void {
    const player = this.room.players.find(p => p.peerId === peerId);
    if (player && player.ws.readyState === 1 /* WebSocket.OPEN */) {
      player.ws.send(JSON.stringify({ type: 'message', from: 'server', payload: message }));
    }
  }

  broadcast(message: string): void {
    for (const player of this.room.players) {
      this.send(player.peerId, message);
    }
  }

  onPeerConnected(cb: (peerId: string) => void): void { this.connectCbs.push(cb); }
  onPeerDisconnected(cb: (peerId: string) => void): void { this.disconnectCbs.push(cb); }
  onMessage(cb: (peerId: string, message: string) => void): void { this.messageCbs.push(cb); }
}
