import { BluetoothNetwork, type NearbyPeer } from 'nearby-network';
import { getRandomGameNumber, loadGame, loadGameIndex, type GameData } from '../data/gameLoader';
import { buildServerOptions, validateResumeState } from '../src/gameSetup';
import { InProcessTransport } from '../src/inProcessTransport';
import { createServer, type GameServer } from '../src/server';
import type { Transport } from '../src/transport';
import type { GameState } from '../src/types';
import type { SessionControlMessage, SessionProvider } from './sessionProvider';
import { compareAuthority, createLeaderId, createRoomId, normalizeEpoch, normalizeLeaderId, type SessionAuthority } from './sessionAuthority';

// Keep the wire version at v2 so older Bluetooth builds accept our hello.
// Newer builds advertise board preloading as a capability.
const PROTOCOL_VERSION = 2;
const SUPPORTED_PROTOCOL_VERSIONS = new Set([2, 3]);
const BOARD_PRELOAD_CAPABILITY = 'board-preload-v1';
const SERVER_PEER_ID = 'server';
const HEARTBEAT_MS = 500;
const HEARTBEAT_MISSED_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 1000;
const AUTHORITY_SCAN_MS = 1000;
type Role = 'host' | 'guest';

type BluetoothControl = {
  __nearby: true;
  type: string;
  protocolVersion?: number;
  capabilities?: string[];
  playerName?: string;
  players?: Array<{ peerId: string; name: string; isHost: boolean }>;
  serverPeerId?: string;
  roomCode?: number;
  roomId?: string;
  epoch?: number;
  leaderId?: string;
  oldLeaderId?: string;
  board?: GameData | null;
  isResume?: boolean;
  startId?: number;
  message?: string;
  sentAt?: number;
};

function pickGame(gameId?: number): GameData | null {
  if (gameId) return loadGame(gameId);
  const index = loadGameIndex();
  if (index.totalGames === 0) return null;
  for (let i = 0; i < 5; i++) {
    const game = loadGame(getRandomGameNumber(index.totalGames));
    if (game) return game;
  }
  return null;
}

function playerNamesFromState(state: GameState | null): string[] {
  return state ? Object.values(state.players).map(player => player.name) : [];
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as { unref?: () => void }).unref?.();
}

function isControl(message: string): BluetoothControl | null {
  try {
    const value = JSON.parse(message) as BluetoothControl;
    return value.__nearby === true ? value : null;
  } catch {
    return null;
  }
}

function isClientScreenReady(message: string): boolean {
  try {
    return (JSON.parse(message) as { type?: string }).type === 'CLIENT_SCREEN_READY';
  } catch {
    return false;
  }
}

class BluetoothServerTransport implements Transport {
  private connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];

  constructor(
    private readonly localServer: InProcessTransport,
    private readonly sendRemote: (peerId: string, message: string) => void,
    private readonly stopRemote: () => void,
  ) {
    localServer.onPeerConnected((id, name) => this.connectCbs.forEach(cb => cb(id, name)));
    localServer.onPeerDisconnected(id => this.disconnectCbs.forEach(cb => cb(id)));
    localServer.onMessage((id, message) => this.messageCbs.forEach(cb => cb(id, message)));
  }

  advertise(_displayName: string): void {}
  discover(): void {}
  stop(): void { this.localServer.stop(); this.stopRemote(); }
  send(peerId: string, message: string): void {
    this.localServer.send(peerId, message);
    this.sendRemote(peerId, message);
  }
  broadcast(message: string): void {
    this.localServer.broadcast(message);
    this.sendRemote('*', message);
  }
  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void { this.connectCbs.push(cb); }
  onPeerDisconnected(cb: (peerId: string) => void): void { this.disconnectCbs.push(cb); }
  onMessage(cb: (peerId: string, message: string) => void): void { this.messageCbs.push(cb); }
  connectRemote(peerId: string, playerName: string): void { this.connectCbs.forEach(cb => cb(peerId, playerName)); }
  disconnectRemote(peerId: string): void { this.disconnectCbs.forEach(cb => cb(peerId)); }
  deliverRemote(peerId: string, message: string): void { this.messageCbs.forEach(cb => cb(peerId, message)); }
}

/** BLE-only room lifecycle. This keeps the same JS protocol as Nearby while
 *  using CoreBluetooth underneath. */
export class BluetoothSessionProvider implements SessionProvider {
  readonly mode = 'bluetooth' as const;
  readonly ready: Promise<string>;
  private closed = false;
  private roomCode = 0;
  private roomId = '';
  private epoch = 1;
  private leaderId = '';
  private playerName = '';
  private remotePeerId: string | null = null;
  private remotePlayerName: string | null = null;
  private hostAuthorityAccepted = false;
  private targetRoomCode: number | null = null;
  private localEndpoint: InProcessTransport | null = null;
  private localServer: InProcessTransport | null = null;
  private serverTransport: BluetoothServerTransport | null = null;
  private gameServer: GameServer | null = null;
  private phase: 'lobby' | 'playing' = 'lobby';
  private gameData: GameData | null = null;
  private remoteSupportsBoardPreload = false;
  private preloadedBoard: GameData | null = null;
  private preloadedIsResume = false;
  private nextStartId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private guestHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private guestWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private authorityScanTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostSeenAt = 0;
  private lastGuestSeenAt = 0;
  private hostDisconnectEmitted = false;
  private hostLivenessState: 'connected' | 'missed' | 'dead' = 'connected';
  private guestDisconnectEmitted = false;
  private guestLivenessState: 'connected' | 'missed' | 'dead' = 'connected';
  private pendingStart: {
    startId: number;
    gameData: GameData | null;
    resumeState: GameState | null;
    isResume: boolean;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;
  private controlCbs: ((message: SessionControlMessage) => void)[] = [];
  private errorCbs: ((message: string) => void)[] = [];
  private connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];
  private subscriptions: { remove(): void }[] = [];

  constructor(private readonly role: Role) {
    this.ready = BluetoothNetwork
      ? Promise.resolve(role === 'host' ? 'bluetooth-host' : 'bluetooth-guest')
      : Promise.reject(new Error('Bluetooth play requires an iOS development build'));
    if (!BluetoothNetwork) return;
    this.subscriptions = [
      BluetoothNetwork.addListener('onPeerFound', peer => this.handlePeerFound(peer)),
      BluetoothNetwork.addListener('onPeerConnected', ({ peerId }) => this.handleNativeConnected(peerId)),
      BluetoothNetwork.addListener('onPeerDisconnected', ({ peerId }) => this.handleNativeDisconnected(peerId)),
      BluetoothNetwork.addListener('onMessage', ({ peerId, message }) => this.handleNativeMessage(peerId, message)),
      BluetoothNetwork.addListener('onError', ({ message }) => this.emitError(message)),
    ];
  }

  get isClosed(): boolean { return this.closed; }

  createRoom(playerName: string, requestedRoomCode?: number, authority?: SessionAuthority): void {
    if (this.role !== 'host' || !BluetoothNetwork) return this.emitError('Bluetooth hosting is unavailable');
    this.playerName = playerName;
    this.roomCode = requestedRoomCode ?? (100 + Math.floor(Math.random() * 300));
    this.roomId = authority?.roomId ?? createRoomId();
    this.epoch = normalizeEpoch(authority?.epoch);
    this.leaderId = normalizeLeaderId(authority?.leaderId, createLeaderId());
    BluetoothNetwork.host(this.roomCode, playerName);
    this.emitControl({ type: 'room-created', ...this.authorityFields() });
    this.emitLobby();
  }

  joinRoom(roomCode: number, playerName: string, authority?: SessionAuthority): void {
    if (this.role !== 'guest' || !BluetoothNetwork) return this.emitError('Bluetooth joining is unavailable');
    this.roomCode = roomCode;
    this.playerName = playerName;
    this.roomId = authority?.roomId ?? '';
    this.epoch = normalizeEpoch(authority?.epoch, 0);
    this.leaderId = normalizeLeaderId(authority?.leaderId);
    this.hostAuthorityAccepted = false;
    this.targetRoomCode = roomCode;
    BluetoothNetwork.browse();
  }

  startGame(options?: { gameId?: number; resume?: object }): void {
    if (this.role !== 'host' || !BluetoothNetwork) return;

    const resume = options?.resume as { state?: GameState; board?: GameData | null } | undefined;
    const resumeState = resume ? validateResumeState(resume.state) : null;
    if (resume && !resumeState) return this.emitError('Saved game data is invalid');
    if ((!this.remotePeerId || !this.remotePlayerName) && !resumeState) return this.emitError('Need 2 players to start');

    const gameData = resumeState ? (resume?.board ?? null) : pickGame(options?.gameId);
    if (!this.remotePeerId || !this.remoteSupportsBoardPreload) {
      this.beginGame(gameData, resumeState, !!resumeState, !!this.remotePeerId);
      return;
    }

    const remotePeerId = this.remotePeerId;
    const startId = this.nextStartId++;
    if (this.pendingStart) clearTimeout(this.pendingStart.timeout);
    this.pendingStart = {
      startId,
      gameData,
      resumeState,
      isResume: !!resumeState,
      timeout: setTimeout(() => {
        if (this.pendingStart?.startId !== startId) return;
        this.pendingStart = null;
        this.emitError('Bluetooth start timed out');
      }, 10_000),
    };
    this.sendControl(remotePeerId, {
      type: 'board-preload',
      board: gameData,
      isResume: !!resumeState,
      startId,
      ...this.authorityFields(),
    });
  }

  private beginGame(
    gameData: GameData | null,
    resumeState: GameState | null,
    isResume: boolean,
    sendBoardInStart = false,
  ): void {
    if (!BluetoothNetwork) return;
    const playerNames = this.remotePlayerName
      ? [this.playerName, this.remotePlayerName]
      : playerNamesFromState(resumeState);
    if (playerNames.length < 2) return this.emitError('Need 2 players to start');
    this.gameData = gameData;
    this.phase = 'playing';

    this.localServer = new InProcessTransport(SERVER_PEER_ID);
    this.localEndpoint = new InProcessTransport('bluetooth-host', this.playerName);
    this.localEndpoint.onPeerConnected((id, name) => this.connectCbs.forEach(cb => cb(id, name)));
    this.localEndpoint.onPeerDisconnected(id => this.disconnectCbs.forEach(cb => cb(id)));
    this.localEndpoint.onMessage((id, message) => this.messageCbs.forEach(cb => cb(id, message)));
    const native = BluetoothNetwork;
    this.serverTransport = new BluetoothServerTransport(
      this.localServer,
      (peerId, message) => {
        if (this.remotePeerId && (peerId === '*' || peerId === this.remotePeerId)) native.send(this.remotePeerId, message);
      },
      () => native.stop(),
    );
    this.gameServer = createServer(
      this.serverTransport,
      playerNames,
      buildServerOptions(gameData, resumeState),
    );

    const started = { type: 'game-started', serverPeerId: SERVER_PEER_ID, board: gameData, isResume, ...this.authorityFields() };
    this.emitControl(started);
    if (this.remotePeerId) {
      this.sendControl(this.remotePeerId, {
        type: 'game-started',
        serverPeerId: SERVER_PEER_ID,
        isResume,
        ...(sendBoardInStart ? { board: gameData } : {}),
        ...this.authorityFields(),
      });
    } else {
      this.startAuthorityScan();
    }
    InProcessTransport.link(this.localServer, this.localEndpoint);
  }

  advertise(_displayName: string): void {}
  discover(): void { BluetoothNetwork?.browse(); }
  send(peerId: string, message: string): void {
    if (this.role === 'host') this.localEndpoint?.send(peerId, message);
    else if (BluetoothNetwork && this.remotePeerId && peerId === SERVER_PEER_ID) BluetoothNetwork.send(this.remotePeerId, message);
  }
  broadcast(message: string): void {
    if (this.role === 'host') this.localEndpoint?.broadcast(message);
    else if (BluetoothNetwork && this.remotePeerId) BluetoothNetwork.send(this.remotePeerId, message);
  }
  onPeerConnected(cb: (peerId: string, playerName?: string) => void): void { this.connectCbs.push(cb); }
  onPeerDisconnected(cb: (peerId: string) => void): void { this.disconnectCbs.push(cb); }
  onMessage(cb: (peerId: string, message: string) => void): void { this.messageCbs.push(cb); }
  onControlMessage(cb: (message: SessionControlMessage) => void): void { this.controlCbs.push(cb); }
  onError(cb: (message: string) => void): void { this.errorCbs.push(cb); }

  stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.stopHeartbeatWatchdog();
    this.stopGuestHeartbeat();
    this.stopGuestWatchdog();
    this.stopAuthorityScan();
    this.gameServer?.stop();
    if (this.pendingStart) clearTimeout(this.pendingStart.timeout);
    BluetoothNetwork?.stop();
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
  }

  private handlePeerFound(peer: NearbyPeer): void {
    if (!BluetoothNetwork) return;
    if (this.role === 'guest') {
      if (peer.roomCode !== this.targetRoomCode) return;
      this.targetRoomCode = null;
      this.remotePeerId = peer.peerId;
      BluetoothNetwork.connect(peer.peerId);
      return;
    }
    if (
      this.role === 'host' &&
      this.phase === 'playing' &&
      peer.roomCode === this.roomCode &&
      peer.peerId !== this.remotePeerId
    ) {
      BluetoothNetwork.connect(peer.peerId);
    }
  }

  private handleNativeConnected(peerId: string): void {
    if (this.role === 'host') {
      this.sendControl(peerId, { type: 'authority-hello', ...this.authorityFields() });
    } else {
      this.remotePeerId = peerId;
    }
    if (this.role === 'guest') {
      this.notePotentialHostSeen();
      this.connectCbs.forEach(cb => cb(SERVER_PEER_ID));
    }
    if (this.role === 'guest') {
      this.sendControl(peerId, {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        capabilities: [BOARD_PRELOAD_CAPABILITY],
        playerName: this.playerName,
        ...this.knownAuthorityFields(),
      });
    }
  }

  private handleNativeDisconnected(peerId: string): void {
    const wasGameplayPeer = this.role === 'guest' || this.remotePeerId === peerId;
    if (this.remotePeerId === peerId) {
      this.remotePeerId = null;
      this.remotePlayerName = null;
      this.remoteSupportsBoardPreload = false;
      this.hostAuthorityAccepted = false;
      this.stopHeartbeat();
      this.stopGuestHeartbeat();
      this.stopGuestWatchdog();
    }
    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timeout);
      this.pendingStart = null;
    }
    if (wasGameplayPeer && this.serverTransport) this.serverTransport.disconnectRemote(peerId);
    if (wasGameplayPeer) this.disconnectCbs.forEach(cb => cb(this.role === 'guest' ? SERVER_PEER_ID : peerId));
    if (this.role === 'host' && this.phase === 'lobby') this.emitLobby();
    if (this.role === 'host' && this.phase === 'playing' && wasGameplayPeer) this.startAuthorityScan();
  }

  private handleNativeMessage(peerId: string, message: string): void {
    const control = isControl(message);
    if (!control) {
      if (this.role === 'host' && isClientScreenReady(message)) {
        const name = this.remotePlayerName;
        if (name) this.connectCbs.forEach(cb => cb(peerId, name));
        this.emitControl({ type: 'client-screen-ready', ...this.authorityFields() });
        return;
      }
      if (this.role === 'host') this.serverTransport?.deliverRemote(peerId, message);
      else {
        if (this.hostAuthorityAccepted) this.markHostSeen();
        this.messageCbs.forEach(cb => cb(SERVER_PEER_ID, message));
      }
      return;
    }

    if (this.role === 'host' && control.type === 'hello') {
      if (this.handleHostAuthorityConflict(peerId, control)) return;
      if (!SUPPORTED_PROTOCOL_VERSIONS.has(control.protocolVersion ?? 0) || !control.playerName) {
        this.sendControl(peerId, { type: 'room-error', message: 'Incompatible Bluetooth game version' });
        return;
      }
      this.remotePeerId = peerId;
      this.remotePlayerName = control.playerName;
      this.remoteSupportsBoardPreload = control.capabilities?.includes(BOARD_PRELOAD_CAPABILITY) ?? false;
      this.markGuestSeen(peerId);
      this.stopAuthorityScan();
      this.startHeartbeat();
      if (this.phase === 'playing') {
        if (this.remoteSupportsBoardPreload) {
          this.sendControl(peerId, {
            type: 'board-preload',
            board: this.gameData,
            isResume: true,
            ...this.authorityFields(),
          });
        } else {
          this.sendControl(peerId, {
            type: 'game-started',
            serverPeerId: SERVER_PEER_ID,
            board: this.gameData,
            isResume: true,
            ...this.authorityFields(),
          });
        }
        return;
      }
      this.emitLobby();
      return;
    }
    if (this.role === 'host' && control.type === 'authority-hello') {
      if (this.handleHostAuthorityConflict(peerId, control)) return;
      return;
    }
    if (this.role === 'host' && control.type === 'guest-heartbeat') {
      if (this.handleHostAuthorityConflict(peerId, control)) return;
      if (this.remotePeerId === peerId) this.markGuestSeen(peerId);
      return;
    }
    if (this.role === 'host' && control.type === 'board-ready') {
      const pending = this.pendingStart;
      if (pending && control.startId === pending.startId) {
        clearTimeout(pending.timeout);
        this.pendingStart = null;
        this.beginGame(pending.gameData, pending.resumeState, pending.isResume);
        return;
      }
      if (this.phase === 'playing') {
        this.sendControl(peerId, { type: 'game-started', serverPeerId: SERVER_PEER_ID, isResume: true, ...this.authorityFields() });
      }
      return;
    }
    if (this.role === 'host' && control.type === 'game-ready' && this.remotePlayerName) {
      this.serverTransport?.connectRemote(peerId, this.remotePlayerName);
      return;
    }
    if (this.role === 'guest' && control.type === 'board-preload') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.preloadedBoard = control.board ?? null;
      this.preloadedIsResume = !!control.isResume;
      this.sendControl(peerId, {
        type: 'board-ready',
        ...(control.startId != null ? { startId: control.startId } : {}),
      });
      return;
    }
    if (this.role === 'guest' && control.type === 'game-started') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.emitControl({
        type: 'game-started',
        serverPeerId: SERVER_PEER_ID,
        board: control.board ?? this.preloadedBoard,
        isResume: control.isResume ?? this.preloadedIsResume,
        ...this.authorityFields(),
      });
      this.preloadedBoard = null;
      this.preloadedIsResume = false;
      this.sendControl(peerId, { type: 'game-ready' });
      return;
    }
    if (this.role === 'guest' && control.type === 'heartbeat') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.startGuestHeartbeat();
      return;
    }
    if (this.role === 'guest' && control.type === 'lobby-update') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.emitControl(control as SessionControlMessage);
      return;
    }
    this.emitControl(control as SessionControlMessage);
  }

  private emitLobby(): void {
    const players = [
      { peerId: 'bluetooth-host', name: this.playerName, isHost: true },
      ...(this.remotePeerId && this.remotePlayerName
        ? [{ peerId: this.remotePeerId, name: this.remotePlayerName, isHost: false }]
        : []),
    ];
    const message = { type: 'lobby-update', players, ...this.authorityFields() };
    this.emitControl(message);
    if (this.remotePeerId) this.sendControl(this.remotePeerId, message);
  }

  private authorityFields(): { roomCode: number; roomId: string; epoch: number; leaderId: string } {
    return { roomCode: this.roomCode, roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId };
  }

  private knownAuthorityFields(): Partial<SessionAuthority> {
    return this.roomId ? { roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId } : {};
  }

  private controlAuthority(control: BluetoothControl): SessionAuthority | null {
    return control.roomId
      ? {
        roomId: control.roomId,
        epoch: normalizeEpoch(control.epoch, 0),
        leaderId: normalizeLeaderId(control.leaderId),
      }
      : null;
  }

  private currentAuthority(): SessionAuthority | null {
    return this.roomId ? { roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId } : null;
  }

  private handleHostAuthorityConflict(peerId: string, control: BluetoothControl): boolean {
    const incoming = this.controlAuthority(control);
    if (!incoming) return false;
    if (this.roomId && incoming.roomId !== this.roomId) {
      this.sendControl(peerId, { type: 'room-error', message: 'Different Bluetooth game is using this room code' });
      return true;
    }
    const current = this.currentAuthority();
    if (current && compareAuthority(incoming, current) > 0) {
      this.emitControl({ type: 'superseded-host', roomCode: this.roomCode, ...incoming, oldEpoch: this.epoch, oldLeaderId: this.leaderId });
      this.sendControl(peerId, { type: 'room-error', message: 'A newer Bluetooth host is active', ...this.authorityFields() });
      return true;
    }
    return false;
  }

  private acceptHostAuthority(control: BluetoothControl): boolean {
    const incoming = this.controlAuthority(control);
    if (incoming && this.roomId && incoming.roomId !== this.roomId) {
      this.emitError('Different Bluetooth game is using this room code');
      return false;
    }
    if (!incoming) {
      this.hostAuthorityAccepted = true;
      return true;
    }
    const current = this.currentAuthority();
    if (current && compareAuthority(incoming, current) < 0) return false;
    this.roomId = incoming.roomId;
    this.epoch = incoming.epoch;
    this.leaderId = incoming.leaderId;
    this.hostAuthorityAccepted = true;
    return true;
  }

  private startHeartbeat(): void {
    if (this.role !== 'host' || !this.remotePeerId) return;
    this.stopHeartbeat();
    const send = () => {
      if (this.remotePeerId) {
        this.sendControl(this.remotePeerId, {
          type: 'heartbeat',
          sentAt: Date.now(),
          ...this.authorityFields(),
        });
      }
    };
    send();
    this.heartbeatTimer = setInterval(send, HEARTBEAT_MS);
    unrefTimer(this.heartbeatTimer);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startGuestHeartbeat(): void {
    if (this.role !== 'guest' || !this.remotePeerId || this.guestHeartbeatTimer != null) return;
    const send = () => {
      if (this.remotePeerId) {
        this.sendControl(this.remotePeerId, {
          type: 'guest-heartbeat',
          sentAt: Date.now(),
          ...this.authorityFields(),
        });
      }
    };
    send();
    this.guestHeartbeatTimer = setInterval(send, HEARTBEAT_MS);
    unrefTimer(this.guestHeartbeatTimer);
  }

  private stopGuestHeartbeat(): void {
    if (this.guestHeartbeatTimer != null) {
      clearInterval(this.guestHeartbeatTimer);
      this.guestHeartbeatTimer = null;
    }
  }

  private markGuestSeen(peerId: string): void {
    if (this.role !== 'host') return;
    this.remotePeerId = peerId;
    this.lastGuestSeenAt = Date.now();
    this.guestDisconnectEmitted = false;
    if (this.guestLivenessState !== 'connected') {
      this.guestLivenessState = 'connected';
    }
    this.ensureGuestWatchdog();
  }

  private ensureGuestWatchdog(): void {
    if (this.guestWatchdogTimer != null) return;
    this.guestWatchdogTimer = setInterval(() => {
      if (this.closed || this.role !== 'host' || this.guestDisconnectEmitted || !this.remotePeerId) return;
      const silentMs = Date.now() - this.lastGuestSeenAt;
      if (silentMs >= HEARTBEAT_MISSED_MS && this.guestLivenessState === 'connected') {
        this.guestLivenessState = 'missed';
      }
      if (silentMs < HEARTBEAT_TIMEOUT_MS) return;
      const deadPeerId = this.remotePeerId;
      this.guestDisconnectEmitted = true;
      this.guestLivenessState = 'dead';
      this.remotePeerId = null;
      this.remotePlayerName = null;
      this.remoteSupportsBoardPreload = false;
      this.serverTransport?.disconnectRemote(deadPeerId);
      this.disconnectCbs.forEach(cb => cb(deadPeerId));
      if (this.phase === 'lobby') this.emitLobby();
      if (this.phase === 'playing') this.startAuthorityScan();
    }, HEARTBEAT_MS);
    unrefTimer(this.guestWatchdogTimer);
  }

  private stopGuestWatchdog(): void {
    if (this.guestWatchdogTimer != null) {
      clearInterval(this.guestWatchdogTimer);
      this.guestWatchdogTimer = null;
    }
  }

  private markHostSeen(): void {
    this.lastHostSeenAt = Date.now();
    this.hostDisconnectEmitted = false;
    if (this.hostLivenessState !== 'connected') {
      this.hostLivenessState = 'connected';
      this.emitControl({ type: 'host-liveness', state: 'connected', ...this.authorityFields() });
    }
    this.ensureHeartbeatWatchdog();
  }

  private notePotentialHostSeen(): void {
    this.lastHostSeenAt = Date.now();
    this.ensureHeartbeatWatchdog();
  }

  private ensureHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdogTimer != null) return;
    this.heartbeatWatchdogTimer = setInterval(() => {
      if (this.closed || this.role !== 'guest' || this.hostDisconnectEmitted) return;
      const silentMs = Date.now() - this.lastHostSeenAt;
      if (silentMs >= HEARTBEAT_MISSED_MS && this.hostLivenessState === 'connected') {
        this.hostLivenessState = 'missed';
        this.emitControl({ type: 'host-liveness', state: 'missed', ...this.authorityFields() });
      }
      if (silentMs < HEARTBEAT_TIMEOUT_MS) return;
      this.hostDisconnectEmitted = true;
      this.hostLivenessState = 'dead';
      this.emitControl({ type: 'host-liveness', state: 'dead', ...this.authorityFields() });
      this.remotePeerId = null;
      this.remotePlayerName = null;
      this.remoteSupportsBoardPreload = false;
      this.stopGuestHeartbeat();
      this.disconnectCbs.forEach(cb => cb(SERVER_PEER_ID));
    }, HEARTBEAT_MS);
    unrefTimer(this.heartbeatWatchdogTimer);
  }

  private stopHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdogTimer != null) {
      clearInterval(this.heartbeatWatchdogTimer);
      this.heartbeatWatchdogTimer = null;
    }
  }

  private startAuthorityScan(): void {
    if (this.role !== 'host' || this.authorityScanTimer != null) return;
    const browse = () => BluetoothNetwork?.browse();
    browse();
    this.authorityScanTimer = setInterval(browse, AUTHORITY_SCAN_MS);
    unrefTimer(this.authorityScanTimer);
  }

  private stopAuthorityScan(): void {
    if (this.authorityScanTimer != null) {
      clearInterval(this.authorityScanTimer);
      this.authorityScanTimer = null;
    }
  }

  private sendControl(peerId: string, message: Omit<BluetoothControl, '__nearby'>): void {
    BluetoothNetwork?.send(peerId, JSON.stringify({ __nearby: true, ...message }));
  }
  private emitControl(message: SessionControlMessage): void { this.controlCbs.forEach(cb => cb(message)); }
  private emitError(message: string): void { this.errorCbs.forEach(cb => cb(message)); }
}
