import type { Transport } from './transport.js';

export class MockTransport implements Transport {
  private peers: Map<string, MockTransport> = new Map();
  private connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];

  constructor(public readonly id: string) {}

  advertise(_displayName: string): void {}
  discover(): void {}
  stop(): void {}

  /** Wire two MockTransports together — simulates peer discovery + connection */
  static link(a: MockTransport, b: MockTransport): void {
    a.peers.set(b.id, b);
    b.peers.set(a.id, a);
    a.connectCbs.forEach(cb => cb(b.id));
    b.connectCbs.forEach(cb => cb(a.id));
  }

  static unlink(a: MockTransport, b: MockTransport): void {
    a.peers.delete(b.id);
    b.peers.delete(a.id);
    a.disconnectCbs.forEach(cb => cb(b.id));
    b.disconnectCbs.forEach(cb => cb(a.id));
  }

  // Silently drops message if peer is not linked, simulating network loss
  send(peerId: string, message: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.messageCbs.forEach(cb => cb(this.id, message));
    }
  }

  broadcast(message: string): void {
    for (const [peerId] of this.peers) {
      this.send(peerId, message);
    }
  }

  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void {
    this.connectCbs.push(cb);
  }

  onPeerDisconnected(cb: (peerId: string) => void): void {
    this.disconnectCbs.push(cb);
  }

  onMessage(cb: (peerId: string, message: string) => void): void {
    this.messageCbs.push(cb);
  }
}
