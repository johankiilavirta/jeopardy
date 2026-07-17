import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, sendAction, type GameClient } from '../client.js';
import type { GameData } from '../../data/gameLoader';
import type { SessionControlMessage } from '../../app/sessionProvider';

/**
 * Fake in-JS "native layer" standing in for the NearbyNetwork Expo module
 * (which is null under vitest — no iOS runtime). The real module is one
 * singleton per device; here several providers share one mock, so the bus
 * tracks which fake device is "running" (set explicitly around provider
 * calls, and automatically while delivering events) and routes host(),
 * browse(), connect(), send() and stop() between devices accordingly.
 */
const bus = vi.hoisted(() => {
  interface Device {
    peerId: string;
    dead: boolean;
    listeners: Map<string, ((payload: never) => void)[]>;
  }
  const state = {
    devices: [] as Device[],
    current: null as Device | null,
    hosting: null as { device: Device; name: string; roomCode: number } | null,
  };
  function emit(device: Device, event: string, payload: unknown): void {
    const prev = state.current;
    state.current = device;
    try {
      for (const cb of [...(device.listeners.get(event) ?? [])]) (cb as (p: unknown) => void)(payload);
    } finally {
      state.current = prev;
    }
  }
  const find = (peerId: string) => state.devices.find(d => d.peerId === peerId);
  const module = {
    addListener(event: string, cb: (payload: never) => void) {
      const device = state.current!;
      const arr = device.listeners.get(event) ?? [];
      arr.push(cb);
      device.listeners.set(event, arr);
      return {
        remove() {
          const list = device.listeners.get(event) ?? [];
          const i = list.indexOf(cb);
          if (i >= 0) list.splice(i, 1);
        },
      };
    },
    host(roomCode: number, displayName: string) {
      state.hosting = { device: state.current!, name: displayName, roomCode };
    },
    browse() {
      const browser = state.current!;
      const h = state.hosting;
      if (h) emit(browser, 'onPeerFound', { peerId: h.device.peerId, name: h.name, roomCode: h.roomCode });
    },
    connect(peerId: string) {
      const caller = state.current!;
      const target = find(peerId);
      if (!target || target.dead) return;
      emit(target, 'onPeerConnected', { peerId: caller.peerId });
      emit(caller, 'onPeerConnected', { peerId: target.peerId });
    },
    send(peerId: string, message: string) {
      const sender = state.current!;
      const target = find(peerId);
      if (!target || target.dead) return;
      emit(target, 'onMessage', { peerId: sender.peerId, message });
    },
    stop() {
      const caller = state.current!;
      caller.dead = true;
      if (state.hosting?.device === caller) state.hosting = null;
      for (const other of state.devices) {
        if (other !== caller && !other.dead) emit(other, 'onPeerDisconnected', { peerId: caller.peerId });
      }
    },
  };
  return {
    module,
    begin(peerId: string): Device {
      const device: Device = { peerId, dead: false, listeners: new Map() };
      state.devices.push(device);
      state.current = device;
      return device;
    },
    run<T>(device: Device, fn: () => T): T {
      const prev = state.current;
      state.current = device;
      try { return fn(); } finally { state.current = prev; }
    },
    reset() {
      state.devices = [];
      state.current = null;
      state.hosting = null;
    },
  };
});

vi.mock('nearby-network', () => ({ default: bus.module }));

/** Small two-round fixture standing in for the bundled season data:
 *  2+2 clues in round 1, 2 in round 2 → totalClues 6, plus a final. */
const fixtures = vi.hoisted(() => {
  const cat = (name: string, n: number) => ({
    name,
    clues: Array.from({ length: n }, (_, r) => ({ value: (r + 1) * 200, text: `${name} Q${r}`, answer: `A${r}` })),
  });
  return {
    game: (gameNumber: number) => ({
      gameNumber,
      airDate: '1984-09-10',
      round1: [cat('R1A', 2), cat('R1B', 2)],
      round2: [cat('R2A', 2)],
      final: { category: 'FJ', text: 'FJ Q', answer: 'FJ A' },
    }),
  };
});

vi.mock('../../data/gameLoader', () => ({
  loadGameIndex: () => ({ totalGames: 3, seasons: [{ file: 'season-test.json', startGame: 1, endGame: 3 }] }),
  loadGame: (n: number) => (n >= 1 && n <= 3 ? fixtures.game(n) : null),
  getRandomGameNumber: (total: number) => Math.floor(Math.random() * total) + 1,
}));

// Import after the mocks so the provider binds to the fake native module.
import { NearbySessionProvider } from '../../app/nearbySessionProvider';

interface TestPeer {
  provider: NearbySessionProvider;
  controls: SessionControlMessage[];
  client: GameClient | null;
  run<T>(fn: () => T): T;
}

/** Construct a provider on its own fake device, mirroring App.tsx's
 *  handlers: collect control messages and install the game client
 *  synchronously on game-started (before the host links transports). */
function createPeer(role: 'host' | 'guest', peerId: string): TestPeer {
  const device = bus.begin(peerId);
  const provider = bus.run(device, () => new NearbySessionProvider(role));
  const peer: TestPeer = {
    provider,
    controls: [],
    client: null,
    run: fn => bus.run(device, fn),
  };
  provider.onControlMessage(msg => {
    peer.controls.push(msg);
    if (msg.type === 'game-started' && !peer.client) peer.client = createClient(provider);
  });
  return peer;
}

function lastOfType(peer: TestPeer, type: string): SessionControlMessage | undefined {
  return [...peer.controls].reverse().find(m => m.type === type);
}

/** Host creates room 123, guest browses and joins, lobby settles. */
function setupLobby(): { host: TestPeer; guest: TestPeer } {
  const host = createPeer('host', 'HOST');
  const guest = createPeer('guest', 'GUEST-1');
  host.run(() => host.provider.createRoom('Alice', 123));
  guest.run(() => guest.provider.joinRoom(123, 'Bob'));
  return { host, guest };
}

const clue = { id: 0, category: 'R1A', text: 'R1A Q0', answer: 'A0', value: 200 };

describe('NearbySessionProvider', () => {
  beforeEach(() => bus.reset());

  it('runs the lobby handshake over the fake native link', () => {
    const { host, guest } = setupLobby();
    const hostLobby = lastOfType(host, 'lobby-update');
    const guestLobby = lastOfType(guest, 'lobby-update');
    const names = (m: SessionControlMessage | undefined) =>
      (m?.players as { name: string }[] | undefined)?.map(p => p.name);
    expect(names(hostLobby)).toEqual(['Alice', 'Bob']);
    expect(names(guestLobby)).toEqual(['Alice', 'Bob']);
  });

  it('starts a game with a real board on both sides (gameId)', () => {
    const { host, guest } = setupLobby();
    host.run(() => host.provider.startGame({ gameId: 2 }));

    const hostStarted = lastOfType(host, 'game-started');
    const guestStarted = lastOfType(guest, 'game-started');
    expect((hostStarted?.board as GameData).gameNumber).toBe(2);
    expect((guestStarted?.board as GameData).gameNumber).toBe(2);
    expect(hostStarted?.isResume).toBe(false);
    expect(guestStarted?.isResume).toBe(false);

    // The server was armed from the board: fixture clue count + final clue.
    expect(host.client?.state?.totalClues).toBe(6);
    expect(guest.client?.state?.totalClues).toBe(6);
    expect(guest.client?.state?.finalClue).toEqual({ category: 'FJ', text: 'FJ Q', answer: 'FJ A' });
    expect(host.client?.playerId).toBe('alice');
    expect(guest.client?.playerId).toBe('bob');

    host.run(() => host.provider.stop());
  });

  it('round-trips gameplay between guest and the host-side server', () => {
    const { host, guest } = setupLobby();
    host.run(() => host.provider.startGame({ gameId: 1 }));

    guest.run(() => sendAction(guest.provider, 'server', { type: 'SELECT_CLUE', clue }));
    expect(host.client?.state?.status).toBe('CLUE_READING');
    expect(guest.client?.state?.status).toBe('CLUE_READING');
    expect(guest.client?.state?.clueSelectPlayerId).toBe('bob');

    host.run(() => host.provider.stop());
  });

  it('picks a random real game when no gameId is given', () => {
    const { host, guest } = setupLobby();
    host.run(() => host.provider.startGame());

    const board = lastOfType(guest, 'game-started')?.board as GameData;
    expect(board.gameNumber).toBeGreaterThanOrEqual(1);
    expect(board.gameNumber).toBeLessThanOrEqual(3);
    expect(host.client?.state?.totalClues).toBe(6);

    host.run(() => host.provider.stop());
  });

  it('falls back to the demo board for an unknown game number', () => {
    const { host, guest } = setupLobby();
    host.run(() => host.provider.startGame({ gameId: 99 }));

    expect(lastOfType(host, 'game-started')?.board).toBeNull();
    expect(lastOfType(guest, 'game-started')?.board).toBeNull();
    expect(host.client?.state?.totalClues).toBe(30);
    expect(host.client?.state?.finalClue).toBeNull();

    host.run(() => host.provider.stop());
  });
});
