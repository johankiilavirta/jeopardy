import NearbyNetwork, { type NearbyPeer } from 'nearby-network';
import { getRandomGameNumber, loadGame, loadGameIndex, type GameData } from '../data/gameLoader';
import { buildServerOptions, validateResumeState } from '../src/gameSetup';
import { InProcessTransport } from '../src/inProcessTransport';
import { createServer, type GameServer } from '../src/server';
import type { Transport } from '../src/transport';
import type { GameState } from '../src/types';
import type { SessionControlMessage, SessionProvider } from './sessionProvider';

// v2: game-started carries real board data (board + isResume).
const PROTOCOL_VERSION = 2;
const SERVER_PEER_ID = 'server';
type Role = 'host' | 'guest';

type NearbyControl = {
  __nearby: true;
  type: string;
  protocolVersion?: number;
  playerName?: string;
  players?: Array<{ peerId: string; name: string; isHost: boolean }>;
  serverPeerId?: string;
  board?: GameData | null;
  isResume?: boolean;
  message?: string;
};

/** A specific game by number, else a random real game, else null (demo
 *  board fallback when no season data is bundled). */
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

function isControl(message: string): NearbyControl | null {
  try {
    const value = JSON.parse(message) as NearbyControl;
    return value.__nearby === true ? value : null;
  } catch {
    return null;
  }
}

class NearbyServerTransport implements Transport {
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

/** Nearby room lifecycle backed by Apple's Network.framework Expo module. */
export class NearbySessionProvider implements SessionProvider {
  readonly mode = 'nearby' as const;
  readonly ready: Promise<string>;
  private closed = false;
  private roomCode = 0;
  private playerName = '';
  private remotePeerId: string | null = null;
  private remotePlayerName: string | null = null;
  private targetRoomCode: number | null = null;
  private localEndpoint: InProcessTransport | null = null;
  private localServer: InProcessTransport | null = null;
  private serverTransport: NearbyServerTransport | null = null;
  private gameServer: GameServer | null = null;
  private phase: 'lobby' | 'playing' = 'lobby';
  private gameData: GameData | null = null;
  private controlCbs: ((message: SessionControlMessage) => void)[] = [];
  private errorCbs: ((message: string) => void)[] = [];
  private connectCbs: ((peerId: string, playerName?: string) => void)[] = [];
  private disconnectCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: string) => void)[] = [];
  private subscriptions: { remove(): void }[] = [];

  constructor(private readonly role: Role) {
    this.ready = NearbyNetwork
      ? Promise.resolve(role === 'host' ? 'local-host' : 'nearby-guest')
      : Promise.reject(new Error('Nearby play requires an iOS development build'));
    if (!NearbyNetwork) return;
    this.subscriptions = [
      NearbyNetwork.addListener('onPeerFound', peer => this.handlePeerFound(peer)),
      NearbyNetwork.addListener('onPeerConnected', ({ peerId }) => this.handleNativeConnected(peerId)),
      NearbyNetwork.addListener('onPeerDisconnected', ({ peerId }) => this.handleNativeDisconnected(peerId)),
      NearbyNetwork.addListener('onMessage', ({ peerId, message }) => this.handleNativeMessage(peerId, message)),
      NearbyNetwork.addListener('onError', ({ message }) => this.emitError(message)),
    ];
  }

  get isClosed(): boolean { return this.closed; }

  createRoom(playerName: string, requestedRoomCode?: number): void {
    if (this.role !== 'host' || !NearbyNetwork) return this.emitError('Nearby hosting is unavailable');
    this.playerName = playerName;
    this.roomCode = requestedRoomCode ?? (100 + Math.floor(Math.random() * 400));
    NearbyNetwork.host(this.roomCode, playerName);
    this.emitControl({ type: 'room-created', roomCode: this.roomCode });
    this.emitLobby();
  }

  joinRoom(roomCode: number, playerName: string): void {
    if (this.role !== 'guest' || !NearbyNetwork) return this.emitError('Nearby joining is unavailable');
    this.roomCode = roomCode;
    this.playerName = playerName;
    this.targetRoomCode = roomCode;
    NearbyNetwork.browse();
  }

  startGame(options?: { gameId?: number; resume?: object }): void {
    if (this.role !== 'host' || !NearbyNetwork) return;
    if (!this.remotePeerId || !this.remotePlayerName) return this.emitError('Need 2 players to start');

    // Resuming a saved game? The snapshot carries the full GameState plus
    // the board it was playing (mirrors the relay's start-game handling).
    const resume = options?.resume as { state?: GameState; board?: GameData | null } | undefined;
    const resumeState = resume ? validateResumeState(resume.state) : null;
    if (resume && !resumeState) return this.emitError('Saved game data is invalid');

    const gameData = resumeState ? (resume?.board ?? null) : pickGame(options?.gameId);
    this.gameData = gameData;
    this.phase = 'playing';

    this.localServer = new InProcessTransport(SERVER_PEER_ID);
    this.localEndpoint = new InProcessTransport('local-host', this.playerName);
    this.localEndpoint.onPeerConnected((id, name) => this.connectCbs.forEach(cb => cb(id, name)));
    this.localEndpoint.onPeerDisconnected(id => this.disconnectCbs.forEach(cb => cb(id)));
    this.localEndpoint.onMessage((id, message) => this.messageCbs.forEach(cb => cb(id, message)));
    const native = NearbyNetwork;
    this.serverTransport = new NearbyServerTransport(
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

    const started = { type: 'game-started', serverPeerId: SERVER_PEER_ID, board: gameData, isResume: !!resumeState };
    this.emitControl(started);
    this.sendControl(this.remotePeerId, started);
    // The local control callback synchronously installs createClient first.
    InProcessTransport.link(this.localServer, this.localEndpoint);
  }

  advertise(_displayName: string): void {}
  discover(): void { NearbyNetwork?.browse(); }
  send(peerId: string, message: string): void {
    if (this.role === 'host') this.localEndpoint?.send(peerId, message);
    else if (NearbyNetwork && this.remotePeerId && peerId === SERVER_PEER_ID) NearbyNetwork.send(this.remotePeerId, message);
  }
  broadcast(message: string): void {
    if (this.role === 'host') this.localEndpoint?.broadcast(message);
    else if (NearbyNetwork && this.remotePeerId) NearbyNetwork.send(this.remotePeerId, message);
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
    NearbyNetwork?.stop();
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
  }

  private handlePeerFound(peer: NearbyPeer): void {
    if (this.role !== 'guest' || peer.roomCode !== this.targetRoomCode || !NearbyNetwork) return;
    this.targetRoomCode = null;
    this.remotePeerId = peer.peerId;
    NearbyNetwork.connect(peer.peerId);
  }

  private handleNativeConnected(peerId: string): void {
    this.remotePeerId = peerId;
    if (this.role === 'guest') this.connectCbs.forEach(cb => cb(SERVER_PEER_ID));
    if (this.role === 'guest') {
      this.sendControl(peerId, { type: 'hello', protocolVersion: PROTOCOL_VERSION, playerName: this.playerName });
    }
  }

  private handleNativeDisconnected(peerId: string): void {
    if (this.serverTransport) this.serverTransport.disconnectRemote(peerId);
    this.disconnectCbs.forEach(cb => cb(this.role === 'guest' ? SERVER_PEER_ID : peerId));
  }

  private handleNativeMessage(peerId: string, message: string): void {
    const control = isControl(message);
    if (!control) {
      if (this.role === 'host') this.serverTransport?.deliverRemote(peerId, message);
      else this.messageCbs.forEach(cb => cb(SERVER_PEER_ID, message));
      return;
    }

    if (this.role === 'host' && control.type === 'hello') {
      if (control.protocolVersion !== PROTOCOL_VERSION || !control.playerName) {
        this.sendControl(peerId, { type: 'room-error', message: 'Incompatible nearby game version' });
        return;
      }
      this.remotePeerId = peerId;
      this.remotePlayerName = control.playerName;
      if (this.phase === 'playing') {
        // Guest rejoining mid-game (the listener keeps advertising): skip
        // the lobby and go straight to the game. The guest replies
        // game-ready, which reattaches its seat by name below.
        this.sendControl(peerId, {
          type: 'game-started',
          serverPeerId: SERVER_PEER_ID,
          board: this.gameData,
          isResume: true,
        });
        return;
      }
      this.emitLobby();
      return;
    }
    if (this.role === 'host' && control.type === 'game-ready' && this.remotePlayerName) {
      this.serverTransport?.connectRemote(peerId, this.remotePlayerName);
      // Clear the host UI's peer-disconnected banner on (re)connect.
      const name = this.remotePlayerName;
      this.connectCbs.forEach(cb => cb(peerId, name));
      return;
    }
    if (this.role === 'guest' && control.type === 'game-started') {
      this.emitControl({
        type: 'game-started',
        serverPeerId: SERVER_PEER_ID,
        board: control.board ?? null,
        isResume: !!control.isResume,
      });
      this.sendControl(peerId, { type: 'game-ready' });
      return;
    }
    this.emitControl(control as SessionControlMessage);
  }

  private emitLobby(): void {
    const players = [
      { peerId: 'local-host', name: this.playerName, isHost: true },
      ...(this.remotePeerId && this.remotePlayerName
        ? [{ peerId: this.remotePeerId, name: this.remotePlayerName, isHost: false }]
        : []),
    ];
    this.emitControl({ type: 'lobby-update', players });
    if (this.remotePeerId) this.sendControl(this.remotePeerId, { type: 'lobby-update', players });
  }

  private sendControl(peerId: string, message: Omit<NearbyControl, '__nearby'>): void {
    NearbyNetwork?.send(peerId, JSON.stringify({ __nearby: true, ...message }));
  }
  private emitControl(message: SessionControlMessage): void { this.controlCbs.forEach(cb => cb(message)); }
  private emitError(message: string): void { this.errorCbs.forEach(cb => cb(message)); }
}
