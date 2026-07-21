import NearbyNetwork, { type NearbyPeer } from 'nearby-network';
import { getRandomGameNumber, loadGame, loadGameIndex, type GameData } from '../data/gameLoader';
import { buildServerOptions, validateResumeState } from '../src/gameSetup';
import { InProcessTransport } from '../src/inProcessTransport';
import { createServer, type GameServer } from '../src/server';
import type { Transport } from '../src/transport';
import type { GameState } from '../src/types';
import type { SessionControlMessage, SessionProvider } from './sessionProvider';
import { compareAuthority, compareAuthorityClaims, createLeaderId, createRoomId, nextEpoch, normalizeAuthorityStatus, normalizeEpoch, normalizeLeaderId, type AuthorityClaim, type AuthorityStatus, type SessionAuthority } from './sessionAuthority';

// v2: game-started carries real board data (board + isResume).
const PROTOCOL_VERSION = 2;
const SERVER_PEER_ID = 'server';
const HEARTBEAT_MS = 500;
const HEARTBEAT_MISSED_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 1000;
const AUTHORITY_SCAN_MS = 1000;
/** How long a candidate host serves under the dead host's authority
 *  before committing it (epoch bump + fresh leaderId). Within the lease
 *  the original committed host wins on reappearance and the candidate
 *  silently demotes; a guest joining the candidate commits it early. */
const CANDIDATE_COMMIT_MS = 3000;
type Role = 'host' | 'guest';

type NearbyControl = {
  __nearby: true;
  type: string;
  protocolVersion?: number;
  playerName?: string;
  players?: Array<{ peerId: string; name: string; isHost: boolean }>;
  serverPeerId?: string;
  roomCode?: number;
  roomId?: string;
  epoch?: number;
  leaderId?: string;
  oldLeaderId?: string;
  authorityStatus?: string;
  board?: GameData | null;
  isResume?: boolean;
  message?: string;
  sentAt?: number;
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

function playerNamesFromState(state: GameState | null): string[] {
  return state ? Object.values(state.players).map(player => player.name) : [];
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as { unref?: () => void }).unref?.();
}

function isControl(message: string): NearbyControl | null {
  try {
    const value = JSON.parse(message) as NearbyControl;
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
  private roomId = '';
  private epoch = 1;
  private leaderId = '';
  private authorityStatus: AuthorityStatus = 'active';
  private candidateCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private playerName = '';
  private remotePeerId: string | null = null;
  private remotePlayerName: string | null = null;
  private hostAuthorityAccepted = false;
  private targetRoomCode: number | null = null;
  private localEndpoint: InProcessTransport | null = null;
  private localServer: InProcessTransport | null = null;
  private serverTransport: NearbyServerTransport | null = null;
  private gameServer: GameServer | null = null;
  private phase: 'lobby' | 'playing' = 'lobby';
  private gameData: GameData | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private authorityScanTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostSeenAt = 0;
  private hostDisconnectEmitted = false;
  private hostLivenessState: 'connected' | 'missed' | 'dead' = 'connected';
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

  createRoom(playerName: string, requestedRoomCode?: number, authority?: SessionAuthority, options?: { candidate?: boolean }): void {
    if (this.role !== 'host' || !NearbyNetwork) return this.emitError('Nearby hosting is unavailable');
    this.playerName = playerName;
    this.roomCode = requestedRoomCode ?? (400 + Math.floor(Math.random() * 100));
    this.roomId = authority?.roomId ?? createRoomId();
    this.epoch = normalizeEpoch(authority?.epoch);
    // A candidate serves under the dead host's EXACT triple — including its
    // leaderId. Guests validate hosts with a lexicographic leaderId
    // tiebreak, so a fresh leaderId at the same epoch would be rejected as
    // stale about half the time. The fresh leaderId comes at commit.
    this.leaderId = normalizeLeaderId(authority?.leaderId, createLeaderId());
    if (options?.candidate && authority) {
      this.authorityStatus = 'candidate';
      this.candidateCommitTimer = setTimeout(() => this.commitAuthority(), CANDIDATE_COMMIT_MS);
      unrefTimer(this.candidateCommitTimer);
    }
    NearbyNetwork.host(this.roomCode, playerName);
    this.emitControl({ type: 'room-created', ...this.authorityFields() });
    this.emitLobby();
  }

  joinRoom(roomCode: number, playerName: string, authority?: SessionAuthority): void {
    if (this.role !== 'guest' || !NearbyNetwork) return this.emitError('Nearby joining is unavailable');
    this.roomCode = roomCode;
    this.playerName = playerName;
    this.roomId = authority?.roomId ?? '';
    this.epoch = normalizeEpoch(authority?.epoch, 0);
    this.leaderId = normalizeLeaderId(authority?.leaderId);
    this.hostAuthorityAccepted = false;
    this.targetRoomCode = roomCode;
    NearbyNetwork.browse();
  }

  startGame(options?: { gameId?: number; resume?: object }): void {
    if (this.role !== 'host' || !NearbyNetwork) return;

    // Resuming a saved game? The snapshot carries the full GameState plus
    // the board it was playing (mirrors the relay's start-game handling).
    const resume = options?.resume as { state?: GameState; board?: GameData | null } | undefined;
    const resumeState = resume ? validateResumeState(resume.state) : null;
    if (resume && !resumeState) return this.emitError('Saved game data is invalid');
    if ((!this.remotePeerId || !this.remotePlayerName) && !resumeState) return this.emitError('Need 2 players to start');

    const gameData = resumeState ? (resume?.board ?? null) : pickGame(options?.gameId);
    const playerNames = this.remotePlayerName
      ? [this.playerName, this.remotePlayerName]
      : playerNamesFromState(resumeState);
    if (playerNames.length < 2) return this.emitError('Need 2 players to start');
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
      playerNames,
      buildServerOptions(gameData, resumeState),
    );

    const started = { type: 'game-started', serverPeerId: SERVER_PEER_ID, board: gameData, isResume: !!resumeState, ...this.authorityFields() };
    this.emitControl(started);
    if (this.remotePeerId) this.sendControl(this.remotePeerId, started);
    else this.startAuthorityScan();
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
    this.stopHeartbeat();
    this.stopHeartbeatWatchdog();
    this.stopAuthorityScan();
    this.cancelCandidateCommit();
    this.gameServer?.stop();
    NearbyNetwork?.stop();
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
  }

  private handlePeerFound(peer: NearbyPeer): void {
    if (!NearbyNetwork) return;
    if (this.role === 'guest') {
      if (peer.roomCode !== this.targetRoomCode) return;
      this.targetRoomCode = null;
      this.remotePeerId = peer.peerId;
      NearbyNetwork.connect(peer.peerId);
      return;
    }
    if (
      this.role === 'host' &&
      this.phase === 'playing' &&
      peer.roomCode === this.roomCode &&
      peer.peerId !== this.remotePeerId
    ) {
      NearbyNetwork.connect(peer.peerId);
    }
  }

  private handleNativeConnected(peerId: string): void {
    this.remotePeerId = peerId;
    if (this.role === 'host') {
      this.sendControl(peerId, { type: 'authority-hello', ...this.authorityFields() });
    }
    if (this.role === 'guest') {
      this.notePotentialHostSeen();
      this.connectCbs.forEach(cb => cb(SERVER_PEER_ID));
    }
    if (this.role === 'guest') {
      this.sendControl(peerId, {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        playerName: this.playerName,
        ...this.knownAuthorityFields(),
      });
    }
  }

  private handleNativeDisconnected(peerId: string): void {
    if (this.remotePeerId === peerId) {
      this.remotePeerId = null;
      this.remotePlayerName = null;
      this.hostAuthorityAccepted = false;
    }
    if (this.serverTransport) this.serverTransport.disconnectRemote(peerId);
    this.disconnectCbs.forEach(cb => cb(this.role === 'guest' ? SERVER_PEER_ID : peerId));
    if (this.role === 'host' && this.phase === 'lobby') this.emitLobby();
    if (this.role === 'host' && this.phase === 'playing') this.startAuthorityScan();
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
      if (control.protocolVersion !== PROTOCOL_VERSION || !control.playerName) {
        this.sendControl(peerId, { type: 'room-error', message: 'Incompatible nearby game version' });
        return;
      }
      this.remotePeerId = peerId;
      this.remotePlayerName = control.playerName;
      // A joining guest ends the candidate lease early: the room now has a
      // player relying on this host, so commit before sending it the game.
      this.commitAuthority();
      this.stopAuthorityScan();
      this.startHeartbeat();
      if (this.phase === 'playing') {
        // Guest rejoining mid-game (the listener keeps advertising): skip
        // the lobby and go straight to the game. The guest replies
        // game-ready, which reattaches its seat by name below.
        this.sendControl(peerId, {
          type: 'game-started',
          serverPeerId: SERVER_PEER_ID,
          board: this.gameData,
          isResume: true,
          ...this.authorityFields(),
        });
        return;
      }
      this.emitLobby();
      return;
    }
    if (this.role === 'host' && control.type === 'authority-hello') {
      if (this.handleHostAuthorityConflict(peerId, control)) return;
      return;
    }
    if (this.role === 'host' && control.type === 'game-ready' && this.remotePlayerName) {
      this.serverTransport?.connectRemote(peerId, this.remotePlayerName);
      return;
    }
    if (this.role === 'guest' && control.type === 'game-started') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.emitControl({
        type: 'game-started',
        serverPeerId: SERVER_PEER_ID,
        board: control.board ?? null,
        isResume: !!control.isResume,
        ...this.authorityFields(),
      });
      this.sendControl(peerId, { type: 'game-ready' });
      return;
    }
    if (this.role === 'guest' && control.type === 'heartbeat') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      return;
    }
    if (this.role === 'guest' && control.type === 'lobby-update') {
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.emitControl(control as SessionControlMessage);
      return;
    }
    if (this.role === 'guest' && control.type === 'authority-committed') {
      // Our candidate host committed: adopt its bumped authority so future
      // hellos/rejoins carry the new triple, and let the app re-save it.
      if (!this.acceptHostAuthority(control)) return;
      this.markHostSeen();
      this.emitControl(control as SessionControlMessage);
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
    const message = { type: 'lobby-update', players, ...this.authorityFields() };
    this.emitControl(message);
    if (this.remotePeerId) this.sendControl(this.remotePeerId, message);
  }

  private authorityFields(): { roomCode: number; roomId: string; epoch: number; leaderId: string; authorityStatus: AuthorityStatus } {
    return { roomCode: this.roomCode, roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId, authorityStatus: this.authorityStatus };
  }

  private knownAuthorityFields(): Partial<SessionAuthority> {
    return this.roomId ? { roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId } : {};
  }

  private controlAuthority(control: NearbyControl): AuthorityClaim | null {
    return control.roomId
      ? {
        roomId: control.roomId,
        epoch: normalizeEpoch(control.epoch, 0),
        leaderId: normalizeLeaderId(control.leaderId),
        status: normalizeAuthorityStatus(control.authorityStatus),
      }
      : null;
  }

  private currentAuthority(): SessionAuthority | null {
    return this.roomId ? { roomId: this.roomId, epoch: this.epoch, leaderId: this.leaderId } : null;
  }

  private handleHostAuthorityConflict(peerId: string, control: NearbyControl): boolean {
    const incoming = this.controlAuthority(control);
    if (!incoming) return false;
    if (this.roomId && incoming.roomId !== this.roomId) {
      this.sendControl(peerId, { type: 'room-error', message: 'Different nearby game is using this room code' });
      return true;
    }
    const current = this.currentAuthority();
    // Host-to-host (authority-hello) uses claim comparison: at an equal
    // triple a committed host beats a candidate, so a returning original
    // host silently reclaims the room from its lease-holding stand-in.
    // Guest-sourced controls (hello/guest-heartbeat) keep the plain triple
    // comparison: a rejoining guest carries the dead host's triple with no
    // status, and must join the candidate — not supersede it.
    const superseded = current && (control.type === 'authority-hello'
      ? compareAuthorityClaims(incoming, { ...current, status: this.authorityStatus }) > 0
      : compareAuthority(incoming, current) > 0);
    if (superseded) {
      this.cancelCandidateCommit();
      this.emitControl({ type: 'superseded-host', roomCode: this.roomCode, ...incoming, oldEpoch: this.epoch, oldLeaderId: this.leaderId });
      // Tell a searching guest to keep looking for the newer host, but never
      // send this to the newer host itself: its app treats room-error as
      // fatal and would abandon the very game we are about to rejoin.
      if (control.type !== 'authority-hello') {
        this.sendControl(peerId, { type: 'room-error', message: 'A newer nearby host is active', ...this.authorityFields() });
      }
      return true;
    }
    return false;
  }

  private acceptHostAuthority(control: NearbyControl): boolean {
    const incoming = this.controlAuthority(control);
    if (incoming && this.roomId && incoming.roomId !== this.roomId) {
      this.emitError('Different nearby game is using this room code');
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

  /** Candidate → committed: take a fresh epoch + leaderId and announce it.
   *  Fires when the lease expires or a guest joins the candidate. */
  private commitAuthority(): void {
    this.cancelCandidateCommit();
    if (this.closed || this.authorityStatus !== 'candidate') return;
    this.epoch = nextEpoch(this.epoch);
    this.leaderId = createLeaderId();
    this.authorityStatus = 'active';
    this.emitControl({ type: 'authority-committed', ...this.authorityFields() });
    if (this.remotePeerId) this.sendControl(this.remotePeerId, { type: 'authority-committed', ...this.authorityFields() });
  }

  private cancelCandidateCommit(): void {
    if (this.candidateCommitTimer != null) {
      clearTimeout(this.candidateCommitTimer);
      this.candidateCommitTimer = null;
    }
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
    const browse = () => NearbyNetwork?.browse();
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

  private sendControl(peerId: string, message: Omit<NearbyControl, '__nearby'>): void {
    NearbyNetwork?.send(peerId, JSON.stringify({ __nearby: true, ...message }));
  }
  private emitControl(message: SessionControlMessage): void { this.controlCbs.forEach(cb => cb(message)); }
  private emitError(message: string): void { this.errorCbs.forEach(cb => cb(message)); }
}
