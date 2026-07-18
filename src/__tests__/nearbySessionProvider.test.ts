import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, sendAction, type GameClient } from '../client.js';
import { createInitialState } from '../reducer.js';
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
      if (sender.dead) return;
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
    killSilently(peerId: string) {
      const device = find(peerId);
      if (!device) return;
      device.dead = true;
      state.current = device;
      if (state.hosting?.device === device) state.hosting = null;
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

/** Host creates room 423, guest browses and joins, lobby settles. */
function setupLobby(): { host: TestPeer; guest: TestPeer } {
  const host = createPeer('host', 'HOST');
  const guest = createPeer('guest', 'GUEST-1');
  host.run(() => host.provider.createRoom('Alice', 423));
  guest.run(() => guest.provider.joinRoom(423, 'Bob'));
  return { host, guest };
}

const clue = { id: 0, category: 'R1A', text: 'R1A Q0', answer: 'A0', value: 200 };

describe('NearbySessionProvider', () => {
  beforeEach(() => bus.reset());
  afterEach(() => vi.useRealTimers());

  it('runs the lobby handshake over the fake native link', () => {
    const { host, guest } = setupLobby();
    const hostLobby = lastOfType(host, 'lobby-update');
    const guestLobby = lastOfType(guest, 'lobby-update');
    const names = (m: SessionControlMessage | undefined) =>
      (m?.players as { name: string }[] | undefined)?.map(p => p.name);
    expect(typeof lastOfType(host, 'room-created')?.roomId).toBe('string');
    expect(lastOfType(host, 'room-created')?.epoch).toBe(1);
    expect(names(hostLobby)).toEqual(['Alice', 'Bob']);
    expect(names(guestLobby)).toEqual(['Alice', 'Bob']);

    guest.run(() => guest.provider.stop());

    expect(names(lastOfType(host, 'lobby-update'))).toEqual(['Alice']);
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

  it('reattaches a rejoining guest mid-game with the original board and state', () => {
    const { host, guest } = setupLobby();
    host.run(() => host.provider.startGame({ gameId: 1 }));

    // Burn a clue, then the guest's device dies mid-game.
    guest.run(() => sendAction(guest.provider, 'server', { type: 'SKIP_CLUE', clueId: 5 }));
    expect(host.client?.state?.burnedClueIds).toContain(5);

    let hostSawDisconnect = false;
    let hostSawReconnect = false;
    host.provider.onPeerDisconnected(() => { hostSawDisconnect = true; });
    host.provider.onPeerConnected(() => { hostSawReconnect = true; });

    guest.run(() => guest.provider.stop());
    expect(hostSawDisconnect).toBe(true);

    // A fresh guest provider (relaunched app) browses back in by name.
    const rejoined = createPeer('guest', 'GUEST-2');
    rejoined.run(() => rejoined.provider.joinRoom(423, 'Bob'));

    const started = lastOfType(rejoined, 'game-started');
    expect(started?.isResume).toBe(true);
    expect((started?.board as GameData).gameNumber).toBe(1);
    // No lobby detour on rejoin.
    expect(rejoined.controls.some(m => m.type === 'lobby-update')).toBe(false);

    // game-ready reattached the seat by name and pushed the live state.
    expect(rejoined.client?.playerId).toBe('bob');
    expect(rejoined.client?.state?.burnedClueIds).toContain(5);
    expect(hostSawReconnect).toBe(true);

    // The re-linked connection carries gameplay both ways again.
    rejoined.run(() => sendAction(rejoined.provider, 'server', { type: 'SKIP_CLUE', clueId: 6 }));
    expect(host.client?.state?.burnedClueIds).toContain(6);
    expect(rejoined.client?.state?.burnedClueIds).toContain(6);

    host.run(() => host.provider.stop());
  });

  it('resumes from a saved snapshot: server seeded, both sides told isResume', () => {
    const { host, guest } = setupLobby();
    const saved = {
      ...createInitialState(['Alice', 'Bob'], 6, { category: 'FJ', text: 'FJ Q', answer: 'FJ A' }),
      burnedClueIds: [0, 5],
    };
    saved.players['alice']!.score = 400;

    host.run(() => host.provider.startGame({ resume: { state: saved, board: fixtures.game(3) } }));

    expect(lastOfType(host, 'game-started')?.isResume).toBe(true);
    expect(lastOfType(guest, 'game-started')?.isResume).toBe(true);
    expect((lastOfType(guest, 'game-started')?.board as GameData).gameNumber).toBe(3);

    // Seats reattach by name; scores and burned clues carry over.
    expect(host.client?.playerId).toBe('alice');
    expect(host.client?.state?.players['alice']?.score).toBe(400);
    expect(guest.client?.state?.burnedClueIds).toEqual([0, 5]);
    expect(guest.client?.state?.totalClues).toBe(6);

    host.run(() => host.provider.stop());
  });

  it('lets a surviving guest promote a saved nearby game and the old host rejoin', () => {
    const promoted = createPeer('host', 'GUEST-PROMOTED');
    const saved = {
      ...createInitialState(['Alice', 'Bob'], 6, { category: 'FJ', text: 'FJ Q', answer: 'FJ A' }),
      burnedClueIds: [0, 5],
    };
    saved.players['alice']!.score = 400;

    promoted.run(() => promoted.provider.createRoom('Bob', 423, { roomId: 'room-a', epoch: 2 }));
    promoted.run(() => promoted.provider.startGame({ resume: { state: saved, board: fixtures.game(3) } }));

    const promotedStarted = lastOfType(promoted, 'game-started');
    expect(promotedStarted?.isResume).toBe(true);
    expect(promotedStarted?.roomId).toBe('room-a');
    expect(promotedStarted?.epoch).toBe(2);
    expect((promotedStarted?.board as GameData).gameNumber).toBe(3);
    expect(promoted.client?.playerId).toBe('bob');
    expect(promoted.client?.state?.players['alice']?.score).toBe(400);
    expect(promoted.client?.state?.burnedClueIds).toEqual([0, 5]);

    const formerHost = createPeer('guest', 'HOST-REJOIN');
    formerHost.run(() => formerHost.provider.joinRoom(423, 'Alice', { roomId: 'room-a', epoch: 1 }));

    const rejoinStarted = lastOfType(formerHost, 'game-started');
    expect(rejoinStarted?.isResume).toBe(true);
    expect(rejoinStarted?.roomId).toBe('room-a');
    expect(rejoinStarted?.epoch).toBe(2);
    expect((rejoinStarted?.board as GameData).gameNumber).toBe(3);
    expect(formerHost.client?.playerId).toBe('alice');
    expect(formerHost.client?.state?.players['alice']?.score).toBe(400);

    formerHost.run(() => sendAction(formerHost.provider, 'server', { type: 'SKIP_CLUE', clueId: 6 }));
    expect(promoted.client?.state?.burnedClueIds).toContain(6);
    expect(formerHost.client?.state?.burnedClueIds).toContain(6);

    promoted.run(() => promoted.provider.stop());
  });

  it('surfaces a newer epoch so a stale nearby host can demote', () => {
    const staleHost = createPeer('host', 'HOST');
    const newerAuthority = createPeer('guest', 'GUEST-PROMOTED');

    staleHost.run(() => staleHost.provider.createRoom('Alice', 423, { roomId: 'room-a', epoch: 1 }));
    newerAuthority.run(() => newerAuthority.provider.joinRoom(423, 'Bob', { roomId: 'room-a', epoch: 2 }));

    const superseded = lastOfType(staleHost, 'superseded-host');
    expect(superseded?.roomId).toBe('room-a');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.oldEpoch).toBe(1);
    expect(lastOfType(newerAuthority, 'room-error')?.message).toBe('A newer nearby host is active');
  });

  it('detects a silent host death with the heartbeat watchdog', async () => {
    vi.useFakeTimers();
    const { guest } = setupLobby();
    const disconnected: string[] = [];
    guest.provider.onPeerDisconnected(peerId => disconnected.push(peerId));

    bus.killSilently('HOST');
    await vi.advanceTimersByTimeAsync(1200);

    expect(lastOfType(guest, 'host-liveness')?.state).toBe('missed');
    expect(disconnected).toEqual([]);

    await vi.advanceTimersByTimeAsync(6500);

    expect(disconnected).toEqual(['server']);
    expect(lastOfType(guest, 'host-liveness')?.state).toBe('dead');
  });

  it('rejects an invalid resume state without starting a server', () => {
    const { host, guest } = setupLobby();
    const errors: string[] = [];
    host.provider.onError(msg => errors.push(msg));

    host.run(() => host.provider.startGame({ resume: { state: { garbage: true } } }));

    expect(errors).toEqual(['Saved game data is invalid']);
    expect(host.controls.some(m => m.type === 'game-started')).toBe(false);
    expect(guest.controls.some(m => m.type === 'game-started')).toBe(false);
  });
});
