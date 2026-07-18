import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, sendAction, type GameClient } from '../client.js';
import { createInitialState } from '../reducer.js';
import type { GameData } from '../../data/gameLoader';
import type { SessionControlMessage } from '../../app/sessionProvider';

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
    sent: [] as { from: string; to: string; message: string }[],
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
      return { remove() {} };
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
      state.sent.push({ from: sender.peerId, to: peerId, message });
      const target = find(peerId);
      if (!target || target.dead) return;
      emit(target, 'onMessage', { peerId: sender.peerId, message });
    },
    stop() {
      const caller = state.current!;
      caller.dead = true;
      if (state.hosting?.device === caller) state.hosting = null;
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
      state.sent.length = 0;
    },
    sent: state.sent,
  };
});

vi.mock('nearby-network', () => ({ BluetoothNetwork: bus.module }));

const fixtures = vi.hoisted(() => ({
  game: {
    gameNumber: 42,
    airDate: '1984-09-10',
    round1: [{ name: 'R1', clues: [{ value: 200, text: 'Q', answer: 'A' }] }],
    round2: [],
    final: null,
  },
}));

vi.mock('../../data/gameLoader', () => ({
  loadGameIndex: () => ({ totalGames: 1, seasons: [{ file: 'season-test.json', startGame: 1, endGame: 1 }] }),
  loadGame: () => fixtures.game,
  getRandomGameNumber: () => 1,
}));

import { BluetoothSessionProvider } from '../../app/bluetoothSessionProvider';

interface TestPeer {
  provider: BluetoothSessionProvider;
  controls: SessionControlMessage[];
  client: GameClient | null;
  run<T>(fn: () => T): T;
}

function createPeer(role: 'host' | 'guest', peerId: string): TestPeer {
  const device = bus.begin(peerId);
  const provider = bus.run(device, () => new BluetoothSessionProvider(role));
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

function lastOfType(controls: SessionControlMessage[], type: string): SessionControlMessage | undefined {
  return [...controls].reverse().find(m => m.type === type);
}

function sentControls(from: string, to: string): SessionControlMessage[] {
  return bus.sent
    .filter(s => s.from === from && s.to === to)
    .map(s => JSON.parse(s.message) as SessionControlMessage)
    .filter(m => m.__nearby === true);
}

describe('BluetoothSessionProvider', () => {
  beforeEach(() => bus.reset());
  afterEach(() => vi.useRealTimers());

  it('uses bluetooth mode and settles a lobby over the native module boundary', () => {
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');

    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));

    expect(host.provider.mode).toBe('bluetooth');
    const hostLobby = lastOfType(host.controls, 'lobby-update');
    const guestLobby = lastOfType(guest.controls, 'lobby-update');
    const names = (m: SessionControlMessage | undefined) =>
      (m?.players as { name: string }[] | undefined)?.map(p => p.name);
    expect(typeof lastOfType(host.controls, 'room-created')?.roomId).toBe('string');
    expect(lastOfType(host.controls, 'room-created')?.epoch).toBe(1);
    expect(names(hostLobby)).toEqual(['Alice', 'Bob']);
    expect(names(guestLobby)).toEqual(['Alice', 'Bob']);
  });

  it('preloads the board before sending the game-started transition', () => {
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');

    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));
    host.run(() => host.provider.startGame({ gameId: 42 }));

    const hostToGuest = sentControls('HOST', 'GUEST');
    const startMessages = hostToGuest.filter(m => m.type === 'board-preload' || m.type === 'game-started');
    expect(startMessages.map(m => m.type)).toEqual(['board-preload', 'game-started']);
    expect((startMessages[0]?.board as { gameNumber?: number } | undefined)?.gameNumber).toBe(42);
    expect(startMessages[1]?.board).toBeUndefined();
    expect(lastOfType(guest.controls, 'game-started')?.board).toEqual(fixtures.game);
  });

  it('lets a surviving guest promote a saved Bluetooth game and the old host rejoin', () => {
    const promoted = createPeer('host', 'GUEST-PROMOTED');
    const saved = createInitialState(['Alice', 'Bob'], 1, null);
    saved.players['alice']!.score = 400;
    saved.burnedClueIds = [0];

    promoted.run(() => promoted.provider.createRoom('Bob', 142, { roomId: 'room-a', epoch: 2 }));
    promoted.run(() => promoted.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    const promotedStarted = lastOfType(promoted.controls, 'game-started');
    expect(promotedStarted?.isResume).toBe(true);
    expect(promotedStarted?.roomId).toBe('room-a');
    expect(promotedStarted?.epoch).toBe(2);
    expect((promotedStarted?.board as GameData).gameNumber).toBe(42);
    expect(promoted.client?.playerId).toBe('bob');
    expect(promoted.client?.state?.players['alice']?.score).toBe(400);
    expect(promoted.client?.state?.burnedClueIds).toEqual([0]);

    const formerHost = createPeer('guest', 'HOST-REJOIN');
    formerHost.run(() => formerHost.provider.joinRoom(142, 'Alice', { roomId: 'room-a', epoch: 1 }));

    const rejoinStarted = lastOfType(formerHost.controls, 'game-started');
    expect(rejoinStarted?.isResume).toBe(true);
    expect(rejoinStarted?.roomId).toBe('room-a');
    expect(rejoinStarted?.epoch).toBe(2);
    expect((rejoinStarted?.board as GameData).gameNumber).toBe(42);
    expect(formerHost.client?.playerId).toBe('alice');
    expect(formerHost.client?.state?.players['alice']?.score).toBe(400);

    formerHost.run(() => sendAction(formerHost.provider, 'server', { type: 'SKIP_CLUE', clueId: 1 }));
    expect(promoted.client?.state?.burnedClueIds).toContain(1);
    expect(formerHost.client?.state?.burnedClueIds).toContain(1);
  });

  it('surfaces a newer epoch so a stale Bluetooth host can demote', () => {
    const staleHost = createPeer('host', 'HOST');
    const newerAuthority = createPeer('guest', 'GUEST-PROMOTED');

    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, { roomId: 'room-a', epoch: 1 }));
    newerAuthority.run(() => newerAuthority.provider.joinRoom(142, 'Bob', { roomId: 'room-a', epoch: 2 }));

    const superseded = lastOfType(staleHost.controls, 'superseded-host');
    expect(superseded?.roomId).toBe('room-a');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.oldEpoch).toBe(1);
    expect(lastOfType(newerAuthority.controls, 'room-error')?.message).toBe('A newer Bluetooth host is active');
  });

  it('detects a silent host death with the heartbeat watchdog', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.run(() => host.provider.createRoom('Alice', 142));
    guest.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));

    bus.killSilently('HOST');
    await vi.advanceTimersByTimeAsync(5000);

    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('missed');
    expect(disconnected).toEqual([]);

    await vi.advanceTimersByTimeAsync(4000);

    expect(disconnected).toEqual(['server']);
    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('dead');
  });
});
