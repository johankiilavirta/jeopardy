import { WebSocketServer, WebSocket } from 'ws';
import type { Transport } from '../src/transport.js';
import { createServer } from '../src/server.js';

const PORT = 8787;
const PLAYER_NAMES = ['Player 1', 'Player 2'];
const TOTAL_CLUES = 25; // 5×5 board

// --- Relay ---

const wss = new WebSocketServer({ port: PORT });
let nextId = 1;
const peers = new Map<string, WebSocket>();

function relaySend(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  const peerId = `peer-${nextId++}`;
  const existingPeers = Array.from(peers.keys());
  peers.set(peerId, ws);

  // Welcome the newcomer (includes everyone already connected).
  relaySend(ws, { type: 'welcome', peerId, existingPeers });

  // Tell everyone else about the newcomer.
  for (const [id, sock] of peers) {
    if (id !== peerId) relaySend(sock, { type: 'peer-connected', peerId });
  }

  ws.on('message', (raw) => {
    let msg: { type: string; to?: string; payload?: string };
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type !== 'send') return;

    const envelope = { type: 'message', from: peerId, payload: msg.payload };
    if (msg.to === '*') {
      for (const [id, sock] of peers) {
        if (id !== peerId) relaySend(sock, envelope);
      }
    } else {
      const target = peers.get(msg.to!);
      if (target) relaySend(target, envelope);
    }
  });

  ws.on('close', () => {
    peers.delete(peerId);
    for (const [, sock] of peers) {
      relaySend(sock, { type: 'peer-disconnected', peerId });
    }
  });
});

console.log(`Relay listening on ws://localhost:${PORT}`);

// --- Game server (loopback client) ---

class NodeWSTransport implements Transport {
  private ws: WebSocket;
  private connectCbs: ((peerId: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      switch (msg.type) {
        case 'welcome':
          console.log(`Server connected as ${msg.peerId}`);
          for (const id of msg.existingPeers ?? []) {
            this.connectCbs.forEach(cb => cb(id));
          }
          break;
        case 'peer-connected':
          this.connectCbs.forEach(cb => cb(msg.peerId));
          break;
        case 'peer-disconnected':
          this.disconnectCbs.forEach(cb => cb(msg.peerId));
          break;
        case 'message':
          this.messageCbs.forEach(cb => cb(msg.from, msg.payload));
          break;
      }
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

  onPeerConnected(cb: (peerId: string) => void): void { this.connectCbs.push(cb); }
  onPeerDisconnected(cb: (peerId: string) => void): void { this.disconnectCbs.push(cb); }
  onMessage(cb: (peerId: string, message: string) => void): void { this.messageCbs.push(cb); }
}

const serverTransport = new NodeWSTransport(`ws://localhost:${PORT}`);
createServer(serverTransport, PLAYER_NAMES, { totalClues: TOTAL_CLUES });
