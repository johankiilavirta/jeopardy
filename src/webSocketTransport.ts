import type { Transport } from './transport.js';

interface RelayMessage {
  type: string;
  peerId?: string;
  existingPeers?: string[];
  from?: string;
  payload?: string;
  [key: string]: unknown;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private connectCbs: ((peerId: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];
  private rawMessageCbs: ((msg: Record<string, unknown>) => void)[] = [];

  /** Resolves with this peer's assigned ID once the relay sends "welcome". */
  readonly ready: Promise<string>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise(resolve => {
      this.ws.onmessage = (event: MessageEvent) => {
        const msg: RelayMessage = JSON.parse(String(event.data));
        switch (msg.type) {
          case 'welcome':
            resolve(msg.peerId!);
            if (msg.existingPeers) {
              for (const id of msg.existingPeers) {
                this.connectCbs.forEach(cb => cb(id));
              }
            }
            break;
          case 'peer-connected':
            this.connectCbs.forEach(cb => cb(msg.peerId!));
            break;
          case 'peer-disconnected':
            this.disconnectCbs.forEach(cb => cb(msg.peerId!));
            break;
          case 'message':
            this.messageCbs.forEach(cb => cb(msg.from!, msg.payload!));
            break;
          default:
            this.rawMessageCbs.forEach(cb => cb(msg as Record<string, unknown>));
            break;
        }
      };
    });
  }

  advertise(): void {}
  discover(): void {}
  stop(): void { this.ws.close(); }

  send(peerId: string, message: string): void {
    this.ws.send(JSON.stringify({ type: 'send', to: peerId, payload: message }));
  }

  broadcast(message: string): void {
    this.ws.send(JSON.stringify({ type: 'send', to: '*', payload: message }));
  }

  /** Send a raw lobby/control message to the relay. */
  sendRaw(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Register a callback for non-standard relay messages (lobby protocol). */
  onRawMessage(cb: (msg: Record<string, unknown>) => void): void {
    this.rawMessageCbs.push(cb);
  }

  onPeerConnected(cb: (peerId: string) => void): void {
    this.connectCbs.push(cb);
  }

  onPeerDisconnected(cb: (peerId: string) => void): void {
    this.disconnectCbs.push(cb);
  }

  onMessage(cb: (peerId: string, message: string) => void): void {
    this.messageCbs.push(cb);
  }
}
