import { BluetoothNetwork, type NearbyPeer } from 'nearby-network';
import { getRandomGameNumber, loadGame, loadGameIndex, type GameData } from '../data/gameLoader';
import { buildServerOptions, validateResumeState } from '../src/gameSetup';
import { InProcessTransport } from '../src/inProcessTransport';
import { createServer, type GameServer } from '../src/server';
import type { Transport } from '../src/transport';
import type { GameState } from '../src/types';
import type { SessionControlMessage, SessionProvider } from './sessionProvider';

// Keep the wire version at v2 so older Bluetooth builds accept our hello.
// Newer builds advertise board preloading as a capability.
const PROTOCOL_VERSION = 2;
const SUPPORTED_PROTOCOL_VERSIONS = new Set([2, 3]);
const BOARD_PRELOAD_CAPABILITY = 'board-preload-v1';
const SERVER_PEER_ID = 'server';
type Role = 'host' | 'guest';

type BluetoothControl = {
  __nearby: true;
  type: string;
  protocolVersion?: number;
  capabilities?: string[];
  playerName?: string;
  players?: Array<{ peerId: string; name: string; isHost: boolean }>;
  serverPeerId?: string;
  board?: GameData | null;
  isResume?: boolean;
  startId?: number;
  message?: string;
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

function isControl(message: string): BluetoothControl | null {
  try {
    const value = JSON.parse(message) as BluetoothControl;
    return value.__nearby === true ? value : null;
  } catch {
    return null;
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
  private playerName = '';
  private remotePeerId: string | null = null;
  private remotePlayerName: string | null = null;
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

  createRoom(playerName: string, requestedRoomCode?: number): void {
    if (this.role !== 'host' || !BluetoothNetwork) return this.emitError('Bluetooth hosting is unavailable');
    this.playerName = playerName;
    this.roomCode = requestedRoomCode ?? (100 + Math.floor(Math.random() * 300));
    BluetoothNetwork.host(this.roomCode, playerName);
    this.emitControl({ type: 'room-created', roomCode: this.roomCode });
    this.emitLobby();
  }

  joinRoom(roomCode: number, playerName: string): void {
    if (this.role !== 'guest' || !BluetoothNetwork) return this.emitError('Bluetooth joining is unavailable');
    this.roomCode = roomCode;
    this.playerName = playerName;
    this.targetRoomCode = roomCode;
    BluetoothNetwork.browse();
  }

  startGame(options?: { gameId?: number; resume?: object }): void {
    if (this.role !== 'host' || !BluetoothNetwork) return;
    if (!this.remotePeerId || !this.remotePlayerName) return this.emitError('Need 2 players to start');

    const resume = options?.resume as { state?: GameState; board?: GameData | null } | undefined;
    const resumeState = resume ? validateResumeState(resume.state) : null;
    if (resume && !resumeState) return this.emitError('Saved game data is invalid');

    const gameData = resumeState ? (resume?.board ?? null) : pickGame(options?.gameId);
    if (!this.remoteSupportsBoardPreload) {
      this.beginGame(gameData, resumeState, !!resumeState, true);
      return;
    }

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
    this.sendControl(this.remotePeerId, {
      type: 'board-preload',
      board: gameData,
      isResume: !!resumeState,
      startId,
    });
  }

  private beginGame(
    gameData: GameData | null,
    resumeState: GameState | null,
    isResume: boolean,
    sendBoardInStart = false,
  ): void {
    if (!BluetoothNetwork || !this.remotePeerId || !this.remotePlayerName) return;
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
      [this.playerName, this.remotePlayerName],
      buildServerOptions(gameData, resumeState),
    );

    const started = { type: 'game-started', serverPeerId: SERVER_PEER_ID, board: gameData, isResume };
    this.emitControl(started);
    this.sendControl(this.remotePeerId, {
      type: 'game-started',
      serverPeerId: SERVER_PEER_ID,
      isResume,
      ...(sendBoardInStart ? { board: gameData } : {}),
    });
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
    this.gameServer?.stop();
    if (this.pendingStart) clearTimeout(this.pendingStart.timeout);
    BluetoothNetwork?.stop();
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
  }

  private handlePeerFound(peer: NearbyPeer): void {
    if (this.role !== 'guest' || peer.roomCode !== this.targetRoomCode || !BluetoothNetwork) return;
    this.targetRoomCode = null;
    this.remotePeerId = peer.peerId;
    BluetoothNetwork.connect(peer.peerId);
  }

  private handleNativeConnected(peerId: string): void {
    this.remotePeerId = peerId;
    if (this.role === 'guest') this.connectCbs.forEach(cb => cb(SERVER_PEER_ID));
    if (this.role === 'guest') {
      this.sendControl(peerId, {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        capabilities: [BOARD_PRELOAD_CAPABILITY],
        playerName: this.playerName,
      });
    }
  }

  private handleNativeDisconnected(peerId: string): void {
    if (this.remotePeerId === peerId) {
      this.remotePeerId = null;
      this.remotePlayerName = null;
      this.remoteSupportsBoardPreload = false;
    }
    if (this.pendingStart) {
      clearTimeout(this.pendingStart.timeout);
      this.pendingStart = null;
    }
    if (this.serverTransport) this.serverTransport.disconnectRemote(peerId);
    this.disconnectCbs.forEach(cb => cb(this.role === 'guest' ? SERVER_PEER_ID : peerId));
    if (this.role === 'host' && this.phase === 'lobby') this.emitLobby();
  }

  private handleNativeMessage(peerId: string, message: string): void {
    const control = isControl(message);
    if (!control) {
      if (this.role === 'host') this.serverTransport?.deliverRemote(peerId, message);
      else this.messageCbs.forEach(cb => cb(SERVER_PEER_ID, message));
      return;
    }

    if (this.role === 'host' && control.type === 'hello') {
      if (!SUPPORTED_PROTOCOL_VERSIONS.has(control.protocolVersion ?? 0) || !control.playerName) {
        this.sendControl(peerId, { type: 'room-error', message: 'Incompatible Bluetooth game version' });
        return;
      }
      this.remotePeerId = peerId;
      this.remotePlayerName = control.playerName;
      this.remoteSupportsBoardPreload = control.capabilities?.includes(BOARD_PRELOAD_CAPABILITY) ?? false;
      if (this.phase === 'playing') {
        if (this.remoteSupportsBoardPreload) {
          this.sendControl(peerId, {
            type: 'board-preload',
            board: this.gameData,
            isResume: true,
          });
        } else {
          this.sendControl(peerId, {
            type: 'game-started',
            serverPeerId: SERVER_PEER_ID,
            board: this.gameData,
            isResume: true,
          });
        }
        return;
      }
      this.emitLobby();
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
        this.sendControl(peerId, { type: 'game-started', serverPeerId: SERVER_PEER_ID, isResume: true });
      }
      return;
    }
    if (this.role === 'host' && control.type === 'game-ready' && this.remotePlayerName) {
      this.serverTransport?.connectRemote(peerId, this.remotePlayerName);
      const name = this.remotePlayerName;
      this.connectCbs.forEach(cb => cb(peerId, name));
      return;
    }
    if (this.role === 'guest' && control.type === 'board-preload') {
      this.preloadedBoard = control.board ?? null;
      this.preloadedIsResume = !!control.isResume;
      this.sendControl(peerId, {
        type: 'board-ready',
        ...(control.startId != null ? { startId: control.startId } : {}),
      });
      return;
    }
    if (this.role === 'guest' && control.type === 'game-started') {
      this.emitControl({
        type: 'game-started',
        serverPeerId: SERVER_PEER_ID,
        board: control.board ?? this.preloadedBoard,
        isResume: control.isResume ?? this.preloadedIsResume,
      });
      this.preloadedBoard = null;
      this.preloadedIsResume = false;
      this.sendControl(peerId, { type: 'game-ready' });
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
    this.emitControl({ type: 'lobby-update', players });
    if (this.remotePeerId) this.sendControl(this.remotePeerId, { type: 'lobby-update', players });
  }

  private sendControl(peerId: string, message: Omit<BluetoothControl, '__nearby'>): void {
    BluetoothNetwork?.send(peerId, JSON.stringify({ __nearby: true, ...message }));
  }
  private emitControl(message: SessionControlMessage): void { this.controlCbs.forEach(cb => cb(message)); }
  private emitError(message: string): void { this.errorCbs.forEach(cb => cb(message)); }
}
