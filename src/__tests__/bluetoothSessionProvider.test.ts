import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function createPeer(role: 'host' | 'guest', peerId: string) {
  const device = bus.begin(peerId);
  const provider = bus.run(device, () => new BluetoothSessionProvider(role));
  const controls: SessionControlMessage[] = [];
  provider.onControlMessage(msg => controls.push(msg));
  return { provider, controls, run: <T>(fn: () => T) => bus.run(device, fn) };
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
});
