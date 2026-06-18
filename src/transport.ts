/**
 * Transport interface — abstracts the networking layer.
 * Implementations: MultipeerTransport (real), MockTransport (tests)
 */
export interface Transport {
  /** Start advertising this device as available */
  advertise(displayName: string): void;
  /** Start discovering nearby advertisers */
  discover(): void;
  /** Stop advertising/discovering */
  stop(): void;
  /** Send a message to a specific peer */
  send(peerId: string, message: string): void;
  /** Send a message to all connected peers */
  broadcast(message: string): void;

  // Event callbacks
  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void;
  onPeerDisconnected(cb: (peerId: string) => void): void;
  onMessage(cb: (peerId: string, message: string) => void): void;
}
