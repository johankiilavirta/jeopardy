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
    activate(peerId: string) {
      state.current = find(peerId) ?? state.current;
    },
    killSilently(peerId: string) {
      const device = find(peerId);
      if (!device) return;
      device.dead = true;
      state.current = device;
      if (state.hosting?.device === device) state.hosting = null;
    },
    emitTo(peerId: string, event: string, payload: unknown) {
      const device = find(peerId);
      if (device) emit(device, event, payload);
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

const auth = (epoch: number, leaderId = `leader-${epoch}`) => ({ roomId: 'room-a', epoch, leaderId });

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

    promoted.run(() => promoted.provider.createRoom('Bob', 142, auth(2, 'leader-bob')));
    promoted.run(() => promoted.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    const promotedStarted = lastOfType(promoted.controls, 'game-started');
    expect(promotedStarted?.isResume).toBe(true);
    expect(promotedStarted?.roomId).toBe('room-a');
    expect(promotedStarted?.epoch).toBe(2);
    expect((promotedStarted?.board as GameData).gameNumber).toBe(42);
    expect(promoted.client?.playerId).toBe('bob');
    expect(promoted.client?.state?.players['alice']?.score).toBe(400);
    expect(promoted.client?.state?.burnedClueIds).toEqual([0]);

    let promotedSawReconnect = false;
    promoted.provider.onPeerConnected(() => { promotedSawReconnect = true; });

    const formerHost = createPeer('guest', 'HOST-REJOIN');
    formerHost.run(() => formerHost.provider.joinRoom(142, 'Alice', auth(1, 'leader-alice')));

    const rejoinStarted = lastOfType(formerHost.controls, 'game-started');
    expect(rejoinStarted?.isResume).toBe(true);
    expect(rejoinStarted?.roomId).toBe('room-a');
    expect(rejoinStarted?.epoch).toBe(2);
    expect((rejoinStarted?.board as GameData).gameNumber).toBe(42);
    expect(formerHost.client?.playerId).toBe('alice');
    expect(formerHost.client?.state?.players['alice']?.score).toBe(400);
    expect(promotedSawReconnect).toBe(false);

    formerHost.run(() => sendAction(formerHost.provider, 'server', { type: 'CLIENT_SCREEN_READY' }));
    expect(promotedSawReconnect).toBe(true);

    formerHost.run(() => sendAction(formerHost.provider, 'server', { type: 'SKIP_CLUE', clueId: 1 }));
    expect(promoted.client?.state?.burnedClueIds).toContain(1);
    expect(formerHost.client?.state?.burnedClueIds).toContain(1);
  });

  it('surfaces a newer epoch so a stale Bluetooth host can demote', () => {
    const staleHost = createPeer('host', 'HOST');
    const newerAuthority = createPeer('guest', 'GUEST-PROMOTED');

    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, auth(1, 'leader-alice')));
    newerAuthority.run(() => newerAuthority.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));

    const superseded = lastOfType(staleHost.controls, 'superseded-host');
    expect(superseded?.roomId).toBe('room-a');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.oldEpoch).toBe(1);
    expect(lastOfType(newerAuthority.controls, 'room-error')?.message).toBe('A newer Bluetooth host is active');
  });

  it('uses leader id to demote a same-epoch stale Bluetooth host', () => {
    const staleHost = createPeer('host', 'HOST');

    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, auth(2, 'leader-a')));
    bus.emitTo('HOST', 'onMessage', {
      peerId: 'OTHER-HOST',
      message: JSON.stringify({
        __nearby: true,
        type: 'authority-hello',
        roomCode: 142,
        roomId: 'room-a',
        epoch: 2,
        leaderId: 'leader-z',
      }),
    });

    const superseded = lastOfType(staleHost.controls, 'superseded-host');
    expect(superseded?.roomId).toBe('room-a');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.leaderId).toBe('leader-z');
    expect(superseded?.oldLeaderId).toBe('leader-a');
  });

  it('does not mark a stale lower-epoch host connected while recovering', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');

    host.run(() => host.provider.createRoom('Alice', 142, auth(2, 'leader-bob')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));
    bus.killSilently('HOST');
    await vi.advanceTimersByTimeAsync(3200);

    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('dead');
    const controlsAfterDead = guest.controls.length;

    const staleHost = createPeer('host', 'STALE-HOST');
    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, auth(1, 'leader-alice')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));

    const emittedAfterDead = guest.controls.slice(controlsAfterDead);
    expect(emittedAfterDead.some(m => m.type === 'host-liveness' && m.state === 'connected')).toBe(false);
    expect(lastOfType(guest.controls, 'room-error')?.message).toBe('A newer Bluetooth host is active');
  });

  it('does not mark a lower-leader same-epoch host connected while recovering', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');

    host.run(() => host.provider.createRoom('Alice', 142, auth(2, 'leader-z')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-z')));
    bus.killSilently('HOST');
    await vi.advanceTimersByTimeAsync(3200);

    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('dead');
    const controlsAfterDead = guest.controls.length;

    const lowerLeaderHost = createPeer('host', 'LOWER-HOST');
    lowerLeaderHost.run(() => lowerLeaderHost.provider.createRoom('Alice', 142, auth(2, 'leader-a')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-z')));

    const emittedAfterDead = guest.controls.slice(controlsAfterDead);
    expect(emittedAfterDead.some(m => m.type === 'host-liveness' && m.state === 'connected')).toBe(false);
    expect(lastOfType(guest.controls, 'room-error')?.message).toBe('A newer Bluetooth host is active');
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
    await vi.advanceTimersByTimeAsync(3200);

    expect(disconnected).toEqual(['server']);
    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('dead');
  });

  it('detects silent host death after native connect even before authority arrives', async () => {
    vi.useFakeTimers();
    createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    guest.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));
    bus.emitTo('GUEST', 'onPeerConnected', { peerId: 'HOST' });
    bus.killSilently('HOST');

    await vi.advanceTimersByTimeAsync(3200);

    expect(disconnected).toEqual(['server']);
    expect(lastOfType(guest.controls, 'host-liveness')?.state).toBe('dead');
  });

  it('does not disconnect the guest during a brief heartbeat pause', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));

    bus.killSilently('GUEST');
    bus.activate('HOST');
    await vi.advanceTimersByTimeAsync(1200);

    expect(disconnected).toEqual([]);
  });

  it('grays the guest marker fast via guest-liveness, long before disconnecting', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    host.run(() => host.provider.createRoom('Alice', 142, auth(2, 'leader-bob')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));

    bus.killSilently('GUEST');
    bus.activate('HOST');
    await vi.advanceTimersByTimeAsync(900);

    // The UI hint fires well under a second into the silence...
    expect(lastOfType(host.controls, 'guest-liveness')?.state).toBe('missed');
    // ...without any actual disconnect (that still needs the 3s watchdog).
    expect(disconnected).toEqual([]);

    // One resumed heartbeat clears the marker again.
    bus.emitTo('HOST', 'onMessage', {
      peerId: 'GUEST',
      message: JSON.stringify({
        __nearby: true,
        type: 'guest-heartbeat',
        roomCode: 142,
        roomId: 'room-a',
        epoch: 2,
        leaderId: 'leader-bob',
      }),
    });
    expect(lastOfType(host.controls, 'guest-liveness')?.state).toBe('connected');
    expect(disconnected).toEqual([]);
  });

  it('detects a silent guest death with the guest heartbeat watchdog', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));

    bus.killSilently('GUEST');
    bus.activate('HOST');
    await vi.advanceTimersByTimeAsync(3200);

    expect(disconnected).toEqual(['GUEST']);
    const hostLobby = lastOfType(host.controls, 'lobby-update');
    expect((hostLobby?.players as { name: string }[] | undefined)?.map(p => p.name)).toEqual(['Alice']);
  });

  it('keeps the guest connected when guest heartbeats refresh host liveness', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    host.run(() => host.provider.createRoom('Alice', 142, auth(2, 'leader-bob')));
    guest.run(() => guest.provider.joinRoom(142, 'Bob', auth(2, 'leader-bob')));

    await vi.advanceTimersByTimeAsync(800);
    bus.emitTo('HOST', 'onMessage', {
      peerId: 'GUEST',
      message: JSON.stringify({
        __nearby: true,
        type: 'guest-heartbeat',
        roomCode: 142,
        roomId: 'room-a',
        epoch: 2,
        leaderId: 'leader-bob',
      }),
    });
    await vi.advanceTimersByTimeAsync(800);

    expect(disconnected).toEqual([]);
  });

  it('syncs typing over ANSWER_UPDATE deltas, stays live, and converges after undo', async () => {
    vi.useFakeTimers();
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];
    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    guest.provider.onPeerDisconnected(peerId => disconnected.push(peerId));

    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));
    host.run(() => host.provider.startGame({ gameId: 42 }));

    guest.run(() => sendAction(guest.provider, 'server', {
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'R1', text: 'Q', answer: 'A', value: 200 },
    }));
    await vi.advanceTimersByTimeAsync(6000); // reading lockout (~5-5.5s)
    expect(guest.client?.state?.status).toBe('BUZZ_OPEN');
    guest.run(() => sendAction(guest.provider, 'server', { type: 'BUZZ' }));

    // Simulated typing flood: full text every keystroke, like the UI sends.
    const sentBefore = bus.sent.length;
    const word = 'WHAT IS PLUTO ACTUALLY THOUGH SERIOUSLY';
    for (let i = 1; i <= word.length; i++) {
      guest.run(() => sendAction(guest.provider, 'server', { type: 'SET_ANSWER', text: word.slice(0, i) }));
    }
    await vi.advanceTimersByTimeAsync(1200);

    // Both sides converge on the typed text...
    expect(host.client?.state?.buzzes[0]?.answer).toBe(word);
    expect(guest.client?.state?.buzzes[0]?.answer).toBe(word);

    // ...the wire carried compact deltas, never snapshots, for keystrokes...
    const typingWire = bus.sent.slice(sentBefore)
      .filter(s => s.from === 'HOST' && s.to === 'GUEST')
      .map(s => JSON.parse(s.message) as { type?: string });
    expect(typingWire.filter(m => m.type === 'ANSWER_UPDATE')).toHaveLength(word.length);
    expect(typingWire.filter(m => m.type === 'STATE_UPDATE')).toHaveLength(0);

    // ...and liveness never wavered during the burst.
    expect(disconnected).toEqual([]);
    expect(guest.controls.some(m => m.type === 'host-liveness' && m.state !== 'connected')).toBe(false);

    // Undo mid-typing lands both peers back at the board.
    guest.run(() => sendAction(guest.provider, 'server', { type: 'UNDO' }));
    expect(host.client?.state?.status).toBe('CHOOSE_CLUE');
    expect(guest.client?.state?.status).toBe('CHOOSE_CLUE');
    expect(guest.client?.state?.buzzes).toEqual([]);

    // A straggler delta for the undone clue is dropped by the clue-id guard.
    bus.emitTo('GUEST', 'onMessage', {
      peerId: 'HOST',
      message: JSON.stringify({ type: 'ANSWER_UPDATE', playerId: 'bob', clueId: 1, text: 'STALE' }),
    });
    expect(guest.client?.state?.buzzes).toEqual([]);
    expect(guest.client?.state?.status).toBe('CHOOSE_CLUE');
  });

  it('old-host-return loop: demote via epoch, rejoin as guest, one game, deltas flow', async () => {
    vi.useFakeTimers();
    const promoted = createPeer('host', 'GUEST-PROMOTED');
    const saved = createInitialState(['Alice', 'Bob'], 1, null);
    saved.players['alice']!.score = 400;
    saved.players['bob']!.score = 200;

    // Bob promoted himself after Alice's host died and resumed from snapshot.
    promoted.run(() => promoted.provider.createRoom('Bob', 142, auth(2, 'leader-bob')));
    promoted.run(() => promoted.provider.startGame({ resume: { state: saved, board: fixtures.game } }));
    expect(promoted.client?.playerId).toBe('bob');

    // Alice's stale host comes back online still believing it leads (epoch 1).
    const staleHost = createPeer('host', 'OLD-HOST');
    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, auth(1, 'leader-alice')));

    // The promoted host's authority scan finds it and asserts epoch 2.
    // (The mock bus can't route the scan interval's browse() to a device,
    // so deliver the discovery it would produce directly.)
    bus.emitTo('GUEST-PROMOTED', 'onPeerFound', { peerId: 'OLD-HOST', name: 'Alice', roomCode: 142 });
    const superseded = lastOfType(staleHost.controls, 'superseded-host');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.oldEpoch).toBe(1);
    // The demoting side must never tell the WINNING host "a newer host is
    // active": the promoted app treats room-error as fatal and would quit
    // to the menu mid-game.
    expect(lastOfType(promoted.controls, 'room-error')).toBeUndefined();

    // The app reacts by tearing the stale host down and rejoining as guest.
    staleHost.run(() => staleHost.provider.stop());
    const rejoin = createPeer('guest', 'OLD-HOST-REJOIN');
    rejoin.run(() => rejoin.provider.joinRoom(142, 'Alice', auth(1, 'leader-alice')));
    bus.emitTo('OLD-HOST-REJOIN', 'onPeerFound', { peerId: 'GUEST-PROMOTED', name: 'Bob', roomCode: 142 });

    // Resync: same game, scores intact, epoch adopted from the winner.
    const rejoinStarted = lastOfType(rejoin.controls, 'game-started');
    expect(rejoinStarted?.isResume).toBe(true);
    expect(rejoinStarted?.epoch).toBe(2);
    expect(rejoin.client?.playerId).toBe('alice');
    expect(rejoin.client?.state?.players['alice']?.score).toBe(400);
    expect(rejoin.client?.state?.players['bob']?.score).toBe(200);

    // The reunited pair plays on: Alice picks, buzzes, and types — synced
    // to the promoted host through deltas.
    rejoin.run(() => sendAction(rejoin.provider, 'server', {
      type: 'SELECT_CLUE',
      clue: { id: 1, category: 'R1', text: 'Q', answer: 'A', value: 200 },
    }));
    await vi.advanceTimersByTimeAsync(6000);
    rejoin.run(() => sendAction(rejoin.provider, 'server', { type: 'BUZZ' }));
    const sentBefore = bus.sent.length;
    rejoin.run(() => sendAction(rejoin.provider, 'server', { type: 'SET_ANSWER', text: 'CANBERRA' }));

    expect(promoted.client?.state?.buzzes[0]).toMatchObject({ playerId: 'alice', answer: 'CANBERRA' });
    expect(rejoin.client?.state?.buzzes[0]?.answer).toBe('CANBERRA');
    const typingWire = bus.sent.slice(sentBefore)
      .filter(s => s.from === 'GUEST-PROMOTED' && s.to === 'OLD-HOST-REJOIN')
      .map(s => JSON.parse(s.message) as { type?: string });
    expect(typingWire.filter(m => m.type === 'ANSWER_UPDATE')).toHaveLength(1);
    expect(typingWire.filter(m => m.type === 'STATE_UPDATE')).toHaveLength(0);
  });

  it('candidate defers to the returning committed host within the lease and never commits', async () => {
    vi.useFakeTimers();
    const saved = createInitialState(['Alice', 'Bob'], 1, null);

    // Alice's committed host survived a radio blip; Bob's side declared it
    // dead and instantly re-hosted as a CANDIDATE under Alice's exact triple.
    const committed = createPeer('host', 'ORIGINAL-HOST');
    committed.run(() => committed.provider.createRoom('Alice', 142, auth(1, 'leader-alice')));
    committed.run(() => committed.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    const candidate = createPeer('host', 'CANDIDATE');
    candidate.run(() => candidate.provider.createRoom('Bob', 142, auth(1, 'leader-alice'), { candidate: true }));
    candidate.run(() => candidate.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    // The candidate's authority scan finds the original host again.
    bus.emitTo('CANDIDATE', 'onPeerFound', { peerId: 'ORIGINAL-HOST', name: 'Alice', roomCode: 142 });

    // Committed beats candidate at the identical triple: the candidate
    // demotes via the usual superseded-host path...
    const superseded = lastOfType(candidate.controls, 'superseded-host');
    expect(superseded?.epoch).toBe(1);
    expect(superseded?.leaderId).toBe('leader-alice');
    // ...while the committed host is untouched: no supersession, and no
    // fatal room-error was sent its way.
    expect(committed.controls.some(m => m.type === 'superseded-host')).toBe(false);
    expect(lastOfType(committed.controls, 'room-error')).toBeUndefined();

    // A superseded candidate must never commit its lease afterwards.
    await vi.advanceTimersByTimeAsync(3200);
    expect(candidate.controls.some(m => m.type === 'authority-committed')).toBe(false);
  });

  it('commits the candidate lease after ~3s and demotes a later-returning stale host', async () => {
    vi.useFakeTimers();
    const saved = createInitialState(['Alice', 'Bob'], 1, null);

    const candidate = createPeer('host', 'CANDIDATE');
    candidate.run(() => candidate.provider.createRoom('Bob', 142, auth(1, 'leader-alice'), { candidate: true }));
    candidate.run(() => candidate.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    // During the lease the candidate serves under the dead host's triple.
    const started = lastOfType(candidate.controls, 'game-started');
    expect(started?.epoch).toBe(1);
    expect(started?.leaderId).toBe('leader-alice');
    expect(candidate.controls.some(m => m.type === 'authority-committed')).toBe(false);

    await vi.advanceTimersByTimeAsync(3200);

    // Lease expired: epoch bump plus a fresh leaderId, announced to the app.
    const committed = lastOfType(candidate.controls, 'authority-committed');
    expect(committed?.epoch).toBe(2);
    expect(typeof committed?.leaderId).toBe('string');
    expect(committed?.leaderId).not.toBe('leader-alice');

    // Alice's host relaunches still claiming epoch 1 → the existing
    // old-host-return supersession flow demotes it.
    const staleHost = createPeer('host', 'OLD-HOST');
    staleHost.run(() => staleHost.provider.createRoom('Alice', 142, auth(1, 'leader-alice')));
    bus.emitTo('CANDIDATE', 'onPeerFound', { peerId: 'OLD-HOST', name: 'Alice', roomCode: 142 });

    const superseded = lastOfType(staleHost.controls, 'superseded-host');
    expect(superseded?.epoch).toBe(2);
    expect(superseded?.oldEpoch).toBe(1);
    expect(candidate.controls.some(m => m.type === 'superseded-host')).toBe(false);
  });

  it('commits early when a guest joins the candidate, and the guest adopts the new authority', () => {
    vi.useFakeTimers();
    const saved = createInitialState(['Alice', 'Bob'], 1, null);
    saved.players['alice']!.score = 400;

    const candidate = createPeer('host', 'CANDIDATE');
    candidate.run(() => candidate.provider.createRoom('Bob', 142, auth(1, 'leader-alice'), { candidate: true }));
    candidate.run(() => candidate.provider.startGame({ resume: { state: saved, board: fixtures.game } }));

    // The former host's player rejoins as a guest before the lease expires,
    // carrying the dead host's triple: it must JOIN the candidate, not
    // supersede it, and the join commits the candidate immediately.
    const rejoin = createPeer('guest', 'OLD-HOST-REJOIN');
    rejoin.run(() => rejoin.provider.joinRoom(142, 'Alice', auth(1, 'leader-alice')));

    expect(candidate.controls.some(m => m.type === 'superseded-host')).toBe(false);
    const committed = lastOfType(candidate.controls, 'authority-committed');
    expect(committed?.epoch).toBe(2);

    // The guest provider adopted the committed authority and re-emitted it
    // for the app to persist.
    const guestCommit = lastOfType(rejoin.controls, 'authority-committed');
    expect(guestCommit?.epoch).toBe(2);
    expect(guestCommit?.leaderId).toBe(committed?.leaderId);

    // The rejoin lands in the committed game with state intact.
    const rejoinStarted = lastOfType(rejoin.controls, 'game-started');
    expect(rejoinStarted?.epoch).toBe(2);
    expect(rejoin.client?.playerId).toBe('alice');
    expect(rejoin.client?.state?.players['alice']?.score).toBe(400);
  });

  it('does not mark the gameplay guest disconnected when an authority probe disconnects', () => {
    const host = createPeer('host', 'HOST');
    const guest = createPeer('guest', 'GUEST');
    const disconnected: string[] = [];

    host.provider.onPeerDisconnected(peerId => disconnected.push(peerId));
    host.run(() => host.provider.createRoom('Alice', 142));
    guest.run(() => guest.provider.joinRoom(142, 'Bob'));

    bus.emitTo('HOST', 'onPeerConnected', { peerId: 'OTHER-HOST' });
    bus.emitTo('HOST', 'onPeerDisconnected', { peerId: 'OTHER-HOST' });

    expect(disconnected).toEqual([]);
    expect((lastOfType(host.controls, 'lobby-update')?.players as { name: string }[] | undefined)?.map(p => p.name)).toEqual(['Alice', 'Bob']);
  });
});
