import type { Transport } from './transport.js';

/**
 * A synchronous, in-memory Transport endpoint.
 *
 * This is the loopback link between the hosting phone's UI and its local
 * authoritative server. It also makes the complete nearby topology testable
 * before a native Network.framework endpoint is available.
 */
export class InProcessTransport implements Transport {
  private readonly peers = new Map<string, InProcessTransport>();
  private readonly connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private readonly disconnectCbs: ((peerId: string) => void)[] = [];
  private readonly messageCbs: ((peerId: string, message: string) => void)[] = [];

  constructor(
    readonly id: string,
    readonly displayName?: string,
  ) {}

  advertise(_displayName: string): void {}
  discover(): void {}

  stop(): void {
    for (const peer of [...this.peers.values()]) {
      InProcessTransport.unlink(this, peer);
    }
  }

  send(peerId: string, message: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    for (const cb of peer.messageCbs) cb(this.id, message);
  }

  broadcast(message: string): void {
    for (const peerId of this.peers.keys()) this.send(peerId, message);
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

  static link(a: InProcessTransport, b: InProcessTransport): void {
    if (a === b || a.peers.has(b.id) || b.peers.has(a.id)) return;
    a.peers.set(b.id, b);
    b.peers.set(a.id, a);
    for (const cb of a.connectCbs) cb(b.id, b.displayName);
    for (const cb of b.connectCbs) cb(a.id, a.displayName);
  }

  static unlink(a: InProcessTransport, b: InProcessTransport): void {
    const aWasLinked = a.peers.delete(b.id);
    const bWasLinked = b.peers.delete(a.id);
    if (aWasLinked) for (const cb of a.disconnectCbs) cb(b.id);
    if (bWasLinked) for (const cb of b.disconnectCbs) cb(a.id);
  }
}

