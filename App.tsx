import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { createClient } from './src/client';
import type { GameState } from './src/types';
import type { GameData } from './data/gameLoader';
import { OnlineSessionProvider } from './app/onlineSessionProvider';
import { NearbySessionProvider } from './app/nearbySessionProvider';
import { BluetoothSessionProvider } from './app/bluetoothSessionProvider';
import { relayUrls } from './app/relayUrl';
import { DEFAULT_RELAY_HOST } from './app/relayDefaults';
import { connectionModeForRoomCode } from './app/roomCodes';
import type { SessionMode, SessionProvider } from './app/sessionProvider';
import { compareAuthority, createLeaderId, createRoomId, normalizeEpoch, normalizeLeaderId, type SessionAuthority } from './app/sessionAuthority';
import { DemoHarness } from './ui/demo/DemoHarness';
import { NetworkedGame } from './ui/networked/NetworkedGame';
import { MainMenuScreen } from './ui/screens/MainMenuScreen';
import type { CellRect } from './ui/components/BoardCell';
import { JoinGameScreen } from './ui/screens/JoinGameScreen';
import { LobbyScreen, type LobbyPlayer } from './ui/screens/LobbyScreen';
import { ReconnectingScreen } from './ui/screens/ReconnectingScreen';
import {
  clearSession,
  clearSnapshot,
  loadPlayerName,
  loadPreferredConnectionMode,
  loadSession,
  loadSnapshot,
  savePlayerName,
  savePreferredConnectionMode,
  saveSession,
  saveSnapshotBoard,
  saveSnapshotState,
  type SavedSession,
  type SavedSnapshot,
  type PreferredConnectionMode,
} from './app/sessionStore';
import { buildGameKey, computeWinnerNames, isOngoingMatch, loadMatchHistory, recordMatch, recordOngoingMatch, type MatchResult } from './app/matchHistory';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { MatchHistoryScreen } from './ui/screens/MatchHistoryScreen';
import { colors } from './ui/theme/tokens';

const CONNECTION_TIMEOUT_MS = 7000;
/** Local (Bluetooth/nearby) join attempts fail fast: discovery + connect
 *  normally completes in 1-3s, so waiting the full online-relay timeout
 *  just slows down the rejoin retry loop. */
const LOCAL_CONNECTION_TIMEOUT_MS = 3000;
const RECONNECT_RETRY_MS = 3000;
/** How long a guest that lost its host retries reconnecting before
 *  promoting itself to host from the local snapshot. 0 = promote as soon
 *  as the heartbeat watchdog declares the host dead — safe because the
 *  promotion is a reversible CANDIDATE lease, not a committed takeover:
 *  the survivor re-hosts under the dead host's exact authority triple and
 *  only commits (epoch bump + fresh leaderId) once the provider's ~3s
 *  lease expires or a guest joins it. If the original committed host
 *  reappears within the lease, committed-beats-candidate demotes the
 *  stand-in and the original roles restore; anything the candidate did
 *  during the blip is discarded on resync. */
const LOCAL_FAILOVER_PROMOTE_MS = 0;
/** A superseded host demoting itself joins the NEWER host, whose
 *  authority-hello it heard moments ago — so unlike a dead-host failover
 *  it must NOT promote instantly (that would steal hostship right back
 *  and epoch ping-pong forever). Give the join a real grace window; only
 *  if the newer host is truly gone does the demoted side take over. */
const DEMOTION_PROMOTE_GRACE_MS = 6000;
/** A guest RETURNING to a possibly-live game (app relaunch, or waking from
 *  an iOS background freeze) holds stale state by definition — it missed
 *  everything since it went dark. Unlike the 0ms dead-host failover above,
 *  it must NOT insta-promote that stale snapshot: if discovering the
 *  still-live host takes longer than the candidate lease, the stale
 *  candidate commits, supersedes the live game, and reverts every score
 *  earned while the player was away. Join-first for a generous window;
 *  only a room that truly can't be found is worth resurrecting. */
const RETURNING_GUEST_PROMOTE_MS = 8000;

function parseBuzzerDelay(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const extra = Constants.expoConfig?.extra as {
  network?: boolean;
  relayHost?: string;
  room?: string;
  players?: string;
  game?: string;
  uiLab?: boolean;
  uiLabScreen?: string;
} | undefined;

// Read EXPO_PUBLIC_* directly: Expo inlines these into the (web) client
// bundle at build time, whereas Constants.expoConfig.extra only reliably
// carries them on native. Fall back to extra for native dev.
const DEV_ROOM_RAW = process.env.EXPO_PUBLIC_ROOM ?? extra?.room;
const DEV_PLAYERS_RAW = process.env.EXPO_PUBLIC_PLAYERS ?? extra?.players;
const DEV_GAME_RAW = process.env.EXPO_PUBLIC_GAME ?? extra?.game;
const UI_LAB = process.env.EXPO_PUBLIC_UI_LAB === 'true' || extra?.uiLab === true;
const UI_LAB_SCREEN = process.env.EXPO_PUBLIC_UI_LAB_SCREEN ?? extra?.uiLabScreen;

const DEV_ROOM = DEV_ROOM_RAW ? Number(DEV_ROOM_RAW) : null;
// Auto-start once this many players are in the room (default 1 = solo: drop
// straight into the game). Set EXPO_PUBLIC_PLAYERS=2 and open a second tab for
// a multiplayer dev session.
const DEV_PLAYERS = DEV_PLAYERS_RAW ? Math.max(1, Number(DEV_PLAYERS_RAW)) : 1;
// Optional J!Archive game number to load for the dev session.
const DEV_GAME = DEV_GAME_RAW ? Number(DEV_GAME_RAW) : null;
const relayHostFromConfig = process.env.EXPO_PUBLIC_RELAY_HOST ?? extra?.relayHost ?? DEFAULT_RELAY_HOST;

// Session/snapshot persistence and auto-rejoin are disabled in dev
// auto-start mode — the fixed DEV_ROOM flow owns the lifecycle there.
const PERSISTENCE_ENABLED = DEV_ROOM == null;

type AppScreen =
  | { type: 'menu' }
  | { type: 'join'; sourceRect: CellRect | null }
  | { type: 'lobby'; roomCode: number; isHost: boolean }
  | { type: 'game'; serverPeerId: string; roomCode: number; isResume?: boolean }
  | { type: 'reconnecting'; roomCode: number }
  | { type: 'settings' }
  | { type: 'history' }
  | { type: 'demo' };

type LocalRecoveryState = 'none' | 'reconnecting' | 'promoting';
type PeerConnectionStatus = 'connected' | 'remote-disconnected';

function randomPlayerName(): string {
  return `Player ${String(Math.floor(1000 + Math.random() * 9000))}`;
}

function createSessionProvider(
  mode: SessionMode,
  role: 'host' | 'guest',
  relayUrl: string,
): SessionProvider {
  switch (mode) {
    case 'bluetooth':
      return new BluetoothSessionProvider(role);
    case 'nearby':
      return new NearbySessionProvider(role);
    case 'online':
      return new OnlineSessionProvider(relayUrl);
  }
}

function connectionTimeoutMessage(mode: SessionMode): string {
  switch (mode) {
    case 'bluetooth':
      return 'Could not connect over Bluetooth';
    case 'nearby':
      return 'Could not connect nearby';
    case 'online':
      return 'Could not connect to relay';
  }
}

function canAutoRejoinAfterPeerDisconnect(session: SavedSession): boolean {
  return !session.isHost && (session.mode === 'nearby' || session.mode === 'bluetooth');
}

function isLocalSessionMode(mode: SessionMode): boolean {
  return mode === 'nearby' || mode === 'bluetooth';
}

function authorityFromMessage(msg: Record<string, unknown>): SessionAuthority | null {
  return typeof msg.roomId === 'string'
    ? { roomId: msg.roomId, epoch: normalizeEpoch(msg.epoch), leaderId: normalizeLeaderId(msg.leaderId) }
    : null;
}

function sessionAuthority(session: SavedSession): SessionAuthority {
  return { roomId: session.roomId, epoch: session.epoch, leaderId: session.leaderId };
}

/** host-liveness (guest watching the host) and guest-liveness (host
 *  watching the guest) both carry a missed/dead/connected state. */
function isMissedLiveness(msg: Record<string, unknown>): boolean {
  return msg.state === 'missed' || msg.state === 'dead';
}

function messageMatchesSessionAuthority(msg: Record<string, unknown>, session: SavedSession): boolean {
  const authority = authorityFromMessage(msg);
  return !authority || compareAuthority(authority, sessionAuthority(session)) === 0;
}

function isStaleAuthorityForSession(authority: SessionAuthority, session: SavedSession): boolean {
  return authority.roomId !== session.roomId || compareAuthority(authority, sessionAuthority(session)) < 0;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Oswald_500Medium,
    Oswald_700Bold,
  });

  const [screen, setScreen] = useState<AppScreen>(() => (UI_LAB ? { type: 'demo' } : { type: 'menu' }));
  const [playerName, setPlayerName] = useState('');
  const [connectionMode, setConnectionMode] = useState<PreferredConnectionMode>('online');
  const [relayHost, setRelayHost] = useState(relayHostFromConfig);
  const [relayPort, setRelayPort] = useState('8787');
  const [gameId, setGameId] = useState('');
  const [buzzerDelay, setBuzzerDelay] = useState('-1');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [visibleCategories, setVisibleCategories] = useState(6);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSearching, setJoinSearching] = useState(false);
  const [initialGameState, setInitialGameState] = useState<{ state: GameState; playerId: string | null; canUndo?: boolean; canRedo?: boolean } | null>(null);
  const [boardData, setBoardData] = useState<GameData | null>(null);
  const boardDataRef = useRef<GameData | null>(null);
  const [peerConnectionStatus, setPeerConnectionStatus] = useState<PeerConnectionStatus>('connected');
  const [localRecovery, setLocalRecovery] = useState<LocalRecoveryState>('none');
  const transportRef = useRef<SessionProvider | null>(null);
  const joinAttemptRef = useRef(0);
  const myPeerIdRef = useRef<string | null>(null);
  const devAutoStartedRef = useRef(false);
  // Black overlay driven from 0 (transparent) to 1 (opaque) for screen transitions.
  const transitionAnim = useRef(new Animated.Value(0)).current;
  const transitionHeldRef = useRef(false);

  // Match history: a stable per-game id (survives reconnects, cleared on
  // leave/new room) so re-finishing after an undo upserts instead of
  // duplicating. Refs because the []-dep handleStateUpdate reads them.
  const matchIdRef = useRef<string | null>(null);
  const matchStartedAtRef = useRef<number>(Date.now());
  const pendingMatchIdentityRef = useRef<{ gameKey: string; startedAt: number } | null>(null);
  const gameNumberRef = useRef<number | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchResult[]>([]);

  useEffect(() => {
    void loadMatchHistory().then(setRecentMatches);
  }, []);

  // RESUME GAME is offered when an unfinished snapshot is saved on device.
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  /** The live session (room + relay address) while on the game screen. */
  const sessionRef = useRef<SavedSession | null>(null);
  /** Snapshot to seed the next started game with (set by RESUME GAME). */
  const pendingResumeRef = useRef<SavedSnapshot | null>(null);
  /** Game screen waiting behind the lobby fade-out (both host and joiner
   *  fade once the first STATE_UPDATE is in, then swap). */
  const pendingGameScreenRef = useRef<AppScreen | null>(null);
  const [lobbyFadingOut, setLobbyFadingOut] = useState(false);
  const reconnectCtlRef = useRef<{
    cancelled: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    promoteTimer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const leaveRef = useRef<() => void>(() => {});
  const startReconnectRef = useRef<(session: SavedSession, options?: { keepGameMounted?: boolean; promoteDelayMs?: number }) => void>(() => {});
  const promoteLocalSessionRef = useRef<(session: SavedSession) => void>(() => {});

  const disconnect = useCallback(() => {
    transportRef.current?.stop();
    transportRef.current = null;
    myPeerIdRef.current = null;
    setLobbyPlayers([]);
    setLobbyError(null);
    setLocalRecovery('none');
    setPeerConnectionStatus('connected');
  }, []);

  const cancelReconnect = useCallback(() => {
    const ctl = reconnectCtlRef.current;
    if (!ctl) return;
    ctl.cancelled = true;
    if (ctl.timer != null) clearTimeout(ctl.timer);
    if (ctl.promoteTimer != null) clearTimeout(ctl.promoteTimer);
    reconnectCtlRef.current = null;
  }, []);

  const refreshResumeAvailable = useCallback(() => {
    if (!PERSISTENCE_ENABLED) return;
    void loadSnapshot().then(s => setResumeAvailable(!!s));
  }, []);

  /** Every STATE_UPDATE lands here: feed the UI, keep the on-device
   *  snapshot current, and clear all persistence once the game is over. */
  const handleStateUpdate = useCallback((state: GameState, pid: string | null, cu?: boolean, cr?: boolean) => {
    setInitialGameState({ state, playerId: pid, ...(cu != null ? { canUndo: cu } : {}), ...(cr != null ? { canRedo: cr } : {}) });
    if (!PERSISTENCE_ENABLED) return;
    if (state.status === 'GAME_OVER') {
      sessionRef.current = null;
      setResumeAvailable(false);
      void clearSession();
      void clearSnapshot();
      {
        const players = Object.values(state.players).map(p => ({
          name: p.name,
          score: p.score,
          correct: p.correct,
          incorrect: p.incorrect,
          buzzCount: p.buzzCount,
          firstBuzzCount: p.firstBuzzCount,
          reactionMsTotal: p.reactionMsTotal,
          scoreHistory: p.scoreHistory,
          finalWager: state.finalWagers?.[p.id],
        }));
        const gameKey = buildGameKey(gameNumberRef.current, players);
        void recordMatch({
          id: `${gameKey}|completed`,
          status: 'completed',
          gameKey,
          startedAt: matchStartedAtRef.current,
          finishedAt: Date.now(),
          gameNumber: gameNumberRef.current,
          players,
          winnerNames: computeWinnerNames(players),
        }).then(setRecentMatches);
      }
    } else {
      saveSnapshotState(state);
      {
        const players = Object.values(state.players).map(p => ({
          name: p.name,
          score: p.score,
          correct: p.correct,
          incorrect: p.incorrect,
          buzzCount: p.buzzCount,
          firstBuzzCount: p.firstBuzzCount,
          reactionMsTotal: p.reactionMsTotal,
          scoreHistory: p.scoreHistory,
        }));
        const gameKey = buildGameKey(gameNumberRef.current, players);
        if (!matchIdRef.current) {
          matchIdRef.current = `${gameKey}|ongoing`;
          matchStartedAtRef.current = Date.now();
        }
        void recordOngoingMatch({
          id: matchIdRef.current,
          gameKey,
          startedAt: matchStartedAtRef.current,
          finishedAt: 0,
          gameNumber: gameNumberRef.current,
          players,
          winnerNames: [],
          state,
          board: boardDataRef.current,
          mode: sessionRef.current?.mode ?? 'online',
        }).then(setRecentMatches);
      }
    }
  }, []);

  /** The socket died while on the game screen — get back in. */
  const handleSocketLost = useCallback(() => {
    if (!PERSISTENCE_ENABLED) return;
    const session = sessionRef.current;
    if (screenRef.current.type === 'game' && session) {
      startReconnectRef.current(session, {
        keepGameMounted: canAutoRejoinAfterPeerDisconnect(session),
      });
    }
  }, []);

  const handlePeerDisconnected = useCallback(() => {
    // A guest cannot remain in a lobby without its host. Return it to the
    // menu immediately; the host simply receives a lobby update and stays.
    if (screenRef.current.type === 'lobby' && !screenRef.current.isHost) {
      leaveRef.current();
      return;
    }
    const session = sessionRef.current;
    if (
      PERSISTENCE_ENABLED &&
      screenRef.current.type === 'game' &&
      session &&
      canAutoRejoinAfterPeerDisconnect(session)
    ) {
      startReconnectRef.current(session, { keepGameMounted: true });
      return;
    }
    setPeerConnectionStatus('remote-disconnected');
  }, []);

  /** Rejoin a live room, retrying until it works, the relay says the room
   *  is gone, or the player cancels from the Reconnecting screen. */
  const startReconnect = useCallback((session: SavedSession, options: { keepGameMounted?: boolean; promoteDelayMs?: number } = {}) => {
    cancelReconnect();
    const isLocal = isLocalSessionMode(session.mode);
    // A local HOST session must never enter the guest-join loop below:
    // there is no other host to join, so it would sit on RECONNECTING
    // forever and strand the guest too. Re-host from the in-memory
    // snapshot instead — the guest's auto-rejoin finds the new room.
    // (Off the game screen — e.g. relaunch after a kill — joining as a
    // guest is right: the surviving player has already promoted.)
    if (isLocal && session.isHost && screenRef.current.type === 'game') {
      promoteLocalSessionRef.current(session);
      return;
    }
    const keepGameMounted = !!options.keepGameMounted && isLocal && !session.isHost && screenRef.current.type === 'game';
    transportRef.current?.stop();
    transportRef.current = null;
    myPeerIdRef.current = null;
    setLobbyPlayers([]);
    setLobbyError(null);
    setPeerConnectionStatus(keepGameMounted ? 'remote-disconnected' : 'connected');
    setLocalRecovery(keepGameMounted ? 'reconnecting' : 'none');

    const shouldPromote = isLocal && !session.isHost;
    const promoteDelayMs = options.promoteDelayMs ?? LOCAL_FAILOVER_PROMOTE_MS;
    const promoteAfter = shouldPromote ? Date.now() + promoteDelayMs : null;

    const ctl = {
      cancelled: false,
      timer: null as ReturnType<typeof setTimeout> | null,
      promoteTimer: null as ReturnType<typeof setTimeout> | null,
    };
    reconnectCtlRef.current = ctl;
    if (!keepGameMounted) setScreen({ type: 'reconnecting', roomCode: session.roomCode });

    const isActiveReconnect = () => reconnectCtlRef.current === ctl && !ctl.cancelled;

    const finishReconnect = () => {
      if (ctl.timer != null) {
        clearTimeout(ctl.timer);
        ctl.timer = null;
      }
      if (ctl.promoteTimer != null) {
        clearTimeout(ctl.promoteTimer);
        ctl.promoteTimer = null;
      }
      if (reconnectCtlRef.current === ctl) reconnectCtlRef.current = null;
    };

    const promote = () => {
      if (!isActiveReconnect()) return;
      ctl.cancelled = true;
      finishReconnect();
      transportRef.current?.stop();
      transportRef.current = null;
      if (keepGameMounted) setLocalRecovery('promoting');
      promoteLocalSessionRef.current(session);
    };

    // Immediate promotion: skip the reconnect loop entirely rather than
    // starting a guest BLE session that a 0ms timer would tear right down.
    if (shouldPromote && promoteDelayMs === 0) {
      promote();
      return;
    }
    if (shouldPromote) {
      ctl.promoteTimer = setTimeout(promote, promoteDelayMs);
    }

    const giveUp = () => {
      if (!isActiveReconnect()) return;
      ctl.cancelled = true;
      finishReconnect();
      transportRef.current?.stop();
      transportRef.current = null;
      sessionRef.current = null;
      setLocalRecovery('none');
      void clearSession();
      refreshResumeAvailable();
      setScreen({ type: 'menu' });
    };

    const attempt = () => {
      if (!isActiveReconnect()) return;
      // Local guests: a fresh provider restarts discovery; the host's room
      // keeps advertising for the whole game, so re-joining re-attaches.
      const transport = createSessionProvider(
        session.mode,
        'guest',
        relayUrls(session.relayHost, session.relayPort).ws,
      );
      transportRef.current = transport;
      let settled = false;

      const retry = () => {
        if (!isActiveReconnect() || settled) return;
        settled = true;
        transport.stop();
        if (promoteAfter != null && Date.now() >= promoteAfter) {
          promote();
          return;
        }
        ctl.timer = setTimeout(attempt, RECONNECT_RETRY_MS);
      };

      const welcomeTimeout = setTimeout(retry, isLocal ? LOCAL_CONNECTION_TIMEOUT_MS : CONNECTION_TIMEOUT_MS);
      transport.onError(() => {
        if (!isActiveReconnect()) return;
        if (!settled) retry();
        else handleSocketLost();
      });
      transport.onPeerDisconnected(() => {
        if (isActiveReconnect()) {
          retry();
          return;
        }
        handlePeerDisconnected();
      });
      transport.onPeerConnected(() => {
        if (!isActiveReconnect()) return;
        if (!isLocal) setPeerConnectionStatus('connected');
      });

      transport.onControlMessage((msg) => {
        if (!isActiveReconnect()) return;
        switch (msg.type) {
          case 'host-liveness':
            if (messageMatchesSessionAuthority(msg, session)) {
              setPeerConnectionStatus(isMissedLiveness(msg) ? 'remote-disconnected' : 'connected');
            }
            break;
          case 'game-started': {
            const incomingAuthority = authorityFromMessage(msg);
            if (
              incomingAuthority &&
              isStaleAuthorityForSession(incomingAuthority, session)
            ) {
              retry();
              return;
            }
            settled = true;
            clearTimeout(welcomeTimeout);
            finishReconnect();
            setLocalRecovery('none');
            setPeerConnectionStatus('connected');
            const joinedSession = {
              ...session,
              ...(incomingAuthority ?? {}),
              isHost: false,
            };
            const gameScreen: AppScreen = {
              type: 'game',
              serverPeerId: msg.serverPeerId as string,
              roomCode: session.roomCode,
              isResume: !!msg.isResume,
            };
            // Stay on the Reconnecting screen until the first STATE_UPDATE
            // arrives, so the game mounts with real state (see connectAndDo).
            let gameMounted = false;
            createClient(transport, (state, pid, cu, cr) => {
              handleStateUpdate(state, pid, cu, cr);
              if (!gameMounted) {
                gameMounted = true;
                setScreen(gameScreen);
                if (keepGameMounted) {
                  // The game screen never remounted, so onBoardVisible won't
                  // re-send the ready signal that clears this player's
                  // disconnected marker on the host's screen.
                  transport.send(msg.serverPeerId as string, JSON.stringify({ type: 'CLIENT_SCREEN_READY' }));
                }
              }
            });
            const board = (msg.board as GameData) ?? null;
            if (board) {
              setBoardData(board);
              boardDataRef.current = board;
              void saveSnapshotBoard(board, joinedSession.mode);
            }
            // Keep the match id across a reconnect — it's the same game.
            gameNumberRef.current = board?.gameNumber ?? null;
            sessionRef.current = joinedSession;
            void saveSession(joinedSession);
            break;
          }
          case 'lobby-update': {
            const incomingAuthority = authorityFromMessage(msg);
            if (
              incomingAuthority &&
              isStaleAuthorityForSession(incomingAuthority, session)
            ) {
              retry();
              return;
            }
            // The code exists as a lobby again (e.g. the relay restarted
            // and the other player re-created the room). Join it normally.
            settled = true;
            clearTimeout(welcomeTimeout);
            finishReconnect();
            setLocalRecovery('none');
            setPeerConnectionStatus('connected');
            const joinedSession = {
              ...session,
              ...(incomingAuthority ?? {}),
              isHost: false,
            };
            sessionRef.current = joinedSession;
            void saveSession(joinedSession);
            setLobbyPlayers(msg.players as LobbyPlayer[]);
            setScreen({ type: 'lobby', roomCode: session.roomCode, isHost: false });
            break;
          }
          case 'room-error':
            // Online relay room errors are authoritative. Local transports
            // can briefly report failure while the survivor is about to
            // promote or the former host is waiting for that promoted room.
            if (isLocal) retry();
            else {
              settled = true;
              clearTimeout(welcomeTimeout);
              giveUp();
            }
            break;
        }
      });

      transport.ready.then((peerId) => {
        if (!isActiveReconnect()) return;
        myPeerIdRef.current = peerId;
        transport.joinRoom(session.roomCode, session.playerName, sessionAuthority(session));
      });
    };

    attempt();
  }, [cancelReconnect, disconnect, refreshResumeAvailable, handleStateUpdate, handleSocketLost, handlePeerDisconnected]);
  startReconnectRef.current = startReconnect;

  /** Create or join a room. Entering a new room deliberately abandons any
   *  previous session; `resume` seeds the game started from this room with a
   *  saved snapshot. */
  const connectAndDo = useCallback((
    action: 'create' | { join: number },
    resume?: SavedSnapshot,
    mode: SessionMode = 'online',
    options: {
      requestedRoomCode?: number;
      autoStart?: boolean;
      playerName?: string;
      authority?: SessionAuthority;
      candidate?: boolean;
      keepGameMounted?: boolean;
      timeoutMs?: number;
      isCancelled?: () => boolean;
    } = {},
  ) => {
    const isCancelled = () => options.isCancelled?.() ?? false;
    cancelReconnect();
    const keepGameMounted = !!options.keepGameMounted && action === 'create' && isLocalSessionMode(mode) && screenRef.current.type === 'game';
    if (keepGameMounted) {
      transportRef.current?.stop();
      transportRef.current = null;
      myPeerIdRef.current = null;
      setLobbyPlayers([]);
      setLobbyError(null);
      setLocalRecovery('promoting');
      // The brand-new room has no peer attached yet: show the other player
      // as disconnected until their rejoin lands (client-screen-ready).
      setPeerConnectionStatus('remote-disconnected');
    } else {
      disconnect();
    }
    pendingResumeRef.current = resume ?? null;
    pendingGameScreenRef.current = null;
    setLobbyFadingOut(false);
    sessionRef.current = null;
    const resumedIdentity = resume ? pendingMatchIdentityRef.current : null;
    pendingMatchIdentityRef.current = null;
    matchIdRef.current = resumedIdentity ? `${resumedIdentity.gameKey}|ongoing` : null;
    matchStartedAtRef.current = resumedIdentity?.startedAt ?? Date.now();
    if (PERSISTENCE_ENABLED) void clearSession();
    setLobbyError(null);
    setJoinError(null);
    if (!keepGameMounted) setPeerConnectionStatus('connected');

    let roomCode = action !== 'create' ? action.join : 0;
    const effectivePlayerName = options.playerName ?? playerName;
    let roomAuthority = options.authority ?? null;

    // For create, navigate to lobby right away (connection in background).
    // For join, stay on the join screen until we confirm the room exists.
    if (action === 'create' && !keepGameMounted) {
      setScreen({ type: 'lobby', roomCode: 0, isHost: true });
    }

    const transport = createSessionProvider(
      mode,
      action === 'create' ? 'host' : 'guest',
      relayUrls(relayHost, relayPort).ws,
    );
    transportRef.current = transport;

    // Bailing to the menu is only appropriate while the promoted game is
    // still coming up; once it has mounted, errors take the normal mid-game
    // paths (socket-lost reconnect etc.) instead of nuking the session.
    let keptMountedGameUp = false;
    const abandonKeptMountedRecovery = (message: string): boolean => {
      if (!keepGameMounted || keptMountedGameUp) return false;
      sessionRef.current = null;
      pendingResumeRef.current = null;
      pendingGameScreenRef.current = null;
      setLobbyFadingOut(false);
      setLocalRecovery('none');
      setPeerConnectionStatus('connected');
      setLobbyError(message);
      if (PERSISTENCE_ENABLED) void clearSession();
      refreshResumeAvailable();
      setScreen({ type: 'menu' });
      if (transportRef.current === transport) transportRef.current = null;
      myPeerIdRef.current = null;
      transport.stop();
      return true;
    };

    transport.onError((err) => {
      if (isCancelled()) return;
      if (abandonKeptMountedRecovery(err)) return;
      if (screenRef.current.type === 'lobby' && !screenRef.current.isHost) {
        leaveRef.current();
        return;
      }
      // Mid-game socket loss is handled by the rejoin loop, not an error label.
      if (screenRef.current.type === 'game') {
        handleSocketLost();
        return;
      }
      if (action !== 'create') {
        setJoinSearching(false);
        setJoinError(err);
      } else {
        setLobbyError(err);
      }
      if (transitionHeldRef.current) {
        transitionHeldRef.current = false;
        transitionAnim.setValue(0);
      }
    });

    transport.onPeerDisconnected(handlePeerDisconnected);

    transport.onPeerConnected(() => {
      if (!isLocalSessionMode(mode)) setPeerConnectionStatus('connected');
    });

    // For joins, a peer id only means the transport started. Wait for the
    // room response itself so the eight-second "Not Found" state is honest.
    let roomSettled = false;
    const timeout = setTimeout(() => {
      if (isCancelled() || roomSettled) return;
      const err = connectionTimeoutMessage(mode);
      if (abandonKeptMountedRecovery(err)) return;
      if (action !== 'create') {
        setJoinSearching(false);
        setJoinError(err);
      } else {
        setLobbyError(err);
      }
      if (transitionHeldRef.current) {
        transitionHeldRef.current = false;
        transitionAnim.setValue(0);
      }
      transport.stop();
    }, options.timeoutMs ?? CONNECTION_TIMEOUT_MS);

    // Handle lobby kick: when a guest receives LOBBY_KICK, leave immediately.
    transport.onMessage((_peerId, message) => {
      try {
        const msg = JSON.parse(message) as { type?: string };
        if (msg.type === 'LOBBY_KICK' && screenRef.current.type === 'lobby') {
          handleLeave();
        }
      } catch {
        // not a JSON lobby control message — ignore
      }
    });

    transport.onControlMessage((msg) => {
      if (isCancelled()) return;
      switch (msg.type) {
        case 'host-liveness':
        case 'guest-liveness':
          if (!sessionRef.current || messageMatchesSessionAuthority(msg, sessionRef.current)) {
            setPeerConnectionStatus(isMissedLiveness(msg) ? 'remote-disconnected' : 'connected');
          }
          break;
        case 'client-screen-ready':
          if (!sessionRef.current || messageMatchesSessionAuthority(msg, sessionRef.current)) {
            setPeerConnectionStatus('connected');
          }
          break;
        case 'room-created':
          roomSettled = true;
          clearTimeout(timeout);
          roomCode = msg.roomCode as number;
          roomAuthority = authorityFromMessage(msg) ?? roomAuthority;
          if (!keepGameMounted) {
            setScreen({
              type: 'lobby',
              roomCode,
              isHost: true,
            });
          }
          if (transitionHeldRef.current) {
            transitionHeldRef.current = false;
            Animated.timing(transitionAnim, {
              toValue: 0,
              duration: 320,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start();
          }
          setLobbyError(null);
          if (options.autoStart && pendingResumeRef.current) {
            transport.startGame({
              resume: {
                state: pendingResumeRef.current.state,
                board: pendingResumeRef.current.board,
              },
            });
          }
          break;
        case 'lobby-update':
          roomSettled = true;
          clearTimeout(timeout);
          roomAuthority = authorityFromMessage(msg) ?? roomAuthority;
          setLobbyPlayers(msg.players as LobbyPlayer[]);
          setLobbyError(null);
          // If we were on the join screen, now navigate to lobby
          if (action !== 'create') {
            const roomCode = typeof action === 'object' ? action.join : 0;
            setJoinSearching(false);
            setScreen({ type: 'lobby', roomCode, isHost: false });
            if (transitionHeldRef.current) {
              transitionHeldRef.current = false;
              Animated.timing(transitionAnim, {
                toValue: 0,
                duration: 320,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }).start();
            }
          }
          break;
        case 'game-started': {
          // Register message handler BEFORE React re-renders so no
          // STATE_UPDATE messages are lost to the void.
          const gameScreen: AppScreen = {
            type: 'game',
            serverPeerId: msg.serverPeerId as string,
            roomCode,
            isResume: !!msg.isResume,
          };
          let gameMounted = false;
          createClient(transport, (state, pid, cu, cr) => {
            handleStateUpdate(state, pid, cu, cr);
            // Mount the game screen only once the first STATE_UPDATE is in,
            // so NetworkedGame's mount-time animation decisions (category
            // intro, DJ board flash) always see the real game state instead
            // of racing it. From the lobby, fade it out first so host and
            // joiner get the same transition.
            if (!gameMounted) {
              gameMounted = true;
              keptMountedGameUp = true;
              setLocalRecovery('none');
              if (screenRef.current.type === 'lobby') {
                pendingGameScreenRef.current = gameScreen;
                setLobbyFadingOut(true);
              } else {
                setScreen(gameScreen);
              }
            }
          });
          const board = (msg.board as GameData) ?? null;
          setBoardData(board);
          boardDataRef.current = board;
          gameNumberRef.current = board?.gameNumber ?? null;
          if (PERSISTENCE_ENABLED) {
            roomAuthority = authorityFromMessage(msg) ?? roomAuthority ?? { roomId: createRoomId(), epoch: 1, leaderId: createLeaderId() };
            const session = {
              mode,
              roomCode,
              playerName: effectivePlayerName,
              relayHost,
              relayPort,
              roomId: roomAuthority.roomId,
              epoch: roomAuthority.epoch,
              leaderId: roomAuthority.leaderId,
              isHost: action === 'create',
            };
            sessionRef.current = { ...session, savedAt: Date.now() };
            void saveSession(session);
            void saveSnapshotBoard(board, mode);
          }
          break;
        }
        case 'authority-committed': {
          // Fires locally on a candidate host whose lease expired (or that
          // a guest joined), and on a connected guest of that candidate:
          // the tentative authority triple is now committed with a higher
          // epoch, so upgrade the saved session to match.
          const incomingAuthority = authorityFromMessage(msg);
          const session = sessionRef.current;
          if (
            !incomingAuthority ||
            !session ||
            incomingAuthority.roomId !== session.roomId ||
            incomingAuthority.epoch <= session.epoch
          ) break;
          roomAuthority = incomingAuthority;
          const committedSession = { ...session, ...incomingAuthority };
          sessionRef.current = committedSession;
          if (PERSISTENCE_ENABLED) void saveSession(committedSession);
          break;
        }
        case 'superseded-host': {
          const incomingAuthority = authorityFromMessage(msg);
          const code = typeof msg.roomCode === 'number' ? msg.roomCode : roomCode;
          if (!incomingAuthority || !isLocalSessionMode(mode) || code <= 0) return;
          const reconnectSession: SavedSession = {
            mode,
            roomCode: code,
            playerName: effectivePlayerName,
            relayHost,
            relayPort,
            roomId: incomingAuthority.roomId,
            epoch: incomingAuthority.epoch,
            leaderId: incomingAuthority.leaderId,
            isHost: false,
            savedAt: Date.now(),
          };
          // Keep the game mounted while demoting: rejoining the newer host
          // is a dimmed blip, not a trip through the RECONNECTING screen.
          // The grace window stops the demoted side from instantly
          // re-promoting (0ms failover) and ping-ponging hostship forever.
          startReconnectRef.current(reconnectSession, {
            keepGameMounted: true,
            promoteDelayMs: DEMOTION_PROMOTE_GRACE_MS,
          });
          break;
        }
        case 'room-error':
          roomSettled = true;
          clearTimeout(timeout);
          if (abandonKeptMountedRecovery(msg.message as string)) return;
          if (screenRef.current.type === 'lobby' && !screenRef.current.isHost) {
            leaveRef.current();
            return;
          }
          if (action !== 'create') {
            setJoinSearching(false);
            setJoinError(msg.message as string);
          } else {
            setLobbyError(msg.message as string);
          }
          break;
      }
    });

    transport.ready.then((peerId) => {
      if (isCancelled()) {
        transport.stop();
        return;
      }
      if (action === 'create') clearTimeout(timeout);
      myPeerIdRef.current = peerId;
      if (action === 'create') {
        transport.createRoom(
          effectivePlayerName,
          options.requestedRoomCode,
          roomAuthority ?? undefined,
          options.candidate ? { candidate: true } : undefined,
        );
      } else {
        transport.joinRoom(action.join, effectivePlayerName, roomAuthority ?? undefined);
      }
    }).catch((error: unknown) => {
      if (isCancelled()) return;
      const message = error instanceof Error ? error.message : 'Could not start session';
      if (abandonKeptMountedRecovery(message)) return;
      if (action === 'create') setLobbyError(message);
      else {
        setJoinSearching(false);
        setJoinError(message);
      }
      if (transitionHeldRef.current) {
        transitionHeldRef.current = false;
        transitionAnim.setValue(0);
      }
    });
  }, [relayHost, relayPort, playerName, disconnect, cancelReconnect, refreshResumeAvailable, handleStateUpdate, handleSocketLost, handlePeerDisconnected]);

  const promoteLocalSessionToHost = useCallback((session: SavedSession) => {
    // A former GUEST takes over as a reversible CANDIDATE under the dead
    // host's unchanged authority (the provider commits an epoch bump only
    // once its lease expires). A HOST whose transport died re-hosts with
    // its authority verbatim — it already IS the committed leader, so
    // bumping the epoch would just churn supersession on reconnect.
    const authority = {
      roomId: session.roomId,
      epoch: session.epoch,
      leaderId: session.leaderId,
    };
    const candidate = !session.isHost;
    const inMemorySnapshot = initialGameState?.state
      ? {
        state: initialGameState.state,
        board: boardData,
        mode: session.mode,
        savedAt: Date.now(),
      }
      : null;

    if (inMemorySnapshot) {
      connectAndDo('create', inMemorySnapshot, session.mode, {
        requestedRoomCode: session.roomCode,
        autoStart: true,
        playerName: session.playerName,
        authority,
        candidate,
        keepGameMounted: true,
      });
      return;
    }

    void loadSnapshot().then((snapshot) => {
      if (!snapshot || snapshot.mode !== session.mode) {
        disconnect();
        sessionRef.current = null;
        pendingResumeRef.current = null;
        pendingGameScreenRef.current = null;
        setLobbyFadingOut(false);
        void clearSession();
        refreshResumeAvailable();
        setScreen({ type: 'menu' });
        return;
      }
      connectAndDo('create', snapshot, session.mode, {
        requestedRoomCode: session.roomCode,
        autoStart: true,
        playerName: session.playerName,
        authority,
        candidate,
        keepGameMounted: true,
      });
    });
  }, [boardData, connectAndDo, disconnect, initialGameState, refreshResumeAvailable]);
  promoteLocalSessionRef.current = promoteLocalSessionToHost;

  // Dev shortcut: auto-create or join room
  useEffect(() => {
    if (DEV_ROOM == null || devAutoStartedRef.current) return;
    devAutoStartedRef.current = true;
    const transport = new OnlineSessionProvider(relayUrls(relayHost, relayPort).ws);
    transportRef.current = transport;

    transport.onControlMessage((msg) => {
      switch (msg.type) {
        case 'room-created':
          setScreen({ type: 'lobby', roomCode: DEV_ROOM, isHost: true });
          break;
        case 'lobby-update': {
          setLobbyPlayers(msg.players as LobbyPlayer[]);
          const players = msg.players as LobbyPlayer[];
          const myPeerId = myPeerIdRef.current;
          const me = players.find(p => p.peerId === myPeerId);
          if (players.length >= DEV_PLAYERS && me?.isHost) {
            transport.startGame(DEV_GAME ? { gameId: DEV_GAME } : undefined);
          }
          break;
        }
        case 'game-started': {
          createClient(transport, (state, pid, cu, cr) => {
            handleStateUpdate(state, pid, cu, cr);
          });
          const board = (msg.board as GameData) ?? null;
          setBoardData(board);
          boardDataRef.current = board;
          gameNumberRef.current = board?.gameNumber ?? null;
          setScreen({ type: 'game', serverPeerId: msg.serverPeerId as string, roomCode: DEV_ROOM });
          break;
        }
        case 'room-error':
          if (msg.message === 'Room not found') {
            // Recreate the room at the same fixed dev code so a second tab
            // (EXPO_PUBLIC_PLAYERS=2) can deterministically join it.
            transport.createRoom(playerName, DEV_ROOM);
          } else {
            setLobbyError(msg.message as string);
          }
          break;
      }
    });

    transport.ready.then((peerId) => {
      myPeerIdRef.current = peerId;
      transport.joinRoom(DEV_ROOM, playerName);
      setScreen({ type: 'lobby', roomCode: DEV_ROOM, isHost: false });
    });
  }, []);

  /** Lobby finished fading out — mount the game screen waiting behind it. */
  const handleLobbyFadeOutDone = useCallback(() => {
    setLobbyFadingOut(false);
    const next = pendingGameScreenRef.current;
    pendingGameScreenRef.current = null;
    // Guard: a LEAVE mid-fade already navigated away; don't drag the player
    // back into the game.
    if (next && screenRef.current.type === 'lobby') setScreen(next);
  }, []);

  /** Fade to black and keep the destination covered until its room payload
   * arrives. This lets the join screen remain visible during the handoff. */
  const fadeToBlackAndHold = useCallback((action: () => void) => {
    transitionHeldRef.current = true;
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      action();
    });
  }, [transitionAnim]);

  const handleNewGame = useCallback(() => {
    fadeToBlackAndHold(() => connectAndDo('create', undefined, connectionMode));
  }, [connectAndDo, connectionMode, fadeToBlackAndHold]);

  const handleResumeMatch = useCallback((match: MatchResult) => {
    if (!match.state || !isOngoingMatch(match)) return;
    const gameKey = match.gameKey ?? buildGameKey(match.gameNumber, match.players);
    pendingMatchIdentityRef.current = { gameKey, startedAt: match.startedAt ?? Date.now() };
    const snapshot: SavedSnapshot = {
      state: match.state,
      board: match.board ?? null,
      mode: match.mode ?? connectionMode,
      savedAt: match.updatedAt ?? Date.now(),
    };
    // The room-created handler owns the single reveal animation. Finish the
    // black fade before changing screens so the lobby handoff cannot race a
    // second fade animation and flash NEW GAME underneath it.
    transitionHeldRef.current = true;
    transitionAnim.stopAnimation();
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 300,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) connectAndDo('create', snapshot, snapshot.mode);
    });
  }, [connectAndDo, connectionMode, transitionAnim]);

  const handleNameChange = useCallback((name: string) => {
    setPlayerName(name);
    if (PERSISTENCE_ENABLED) void savePlayerName(name);
  }, []);

  const handleJoinNav = useCallback((sourceRect?: CellRect) => {
    setLobbyError(null);
    setJoinError(null);
    setJoinSearching(false);
    setScreen({ type: 'join', sourceRect: sourceRect ?? null });
  }, []);

  const cancelJoinAttempt = useCallback(() => {
    joinAttemptRef.current += 1;
    transitionHeldRef.current = false;
    transitionAnim.setValue(0);
    if (screenRef.current.type === 'join') {
      transportRef.current?.stop();
      transportRef.current = null;
      myPeerIdRef.current = null;
    }
    setJoinSearching(false);
    setJoinError(null);
  }, []);

  const handleJoinSubmit = useCallback((code: number) => {
    const roomMode = connectionModeForRoomCode(code);
    if (!roomMode || roomMode === 'nearby') {
      setJoinSearching(false);
      setJoinError('Enter a Bluetooth or online room code');
      return;
    }
    if (roomMode !== connectionMode) {
      setJoinSearching(false);
      setJoinError(`This is a ${roomMode.toUpperCase()} room. Change Connection in Settings to join it.`);
      return;
    }
    const attempt = joinAttemptRef.current + 1;
    joinAttemptRef.current = attempt;
    setJoinError(null);
    fadeToBlackAndHold(() => {
      setJoinSearching(true);
      connectAndDo({ join: code }, undefined, connectionMode, {
        timeoutMs: 8000,
        isCancelled: () => joinAttemptRef.current !== attempt,
      });
    });
  }, [connectAndDo, connectionMode, fadeToBlackAndHold]);
  const handleConnectionModeChange = useCallback((mode: PreferredConnectionMode) => {
    setConnectionMode(mode);
    if (PERSISTENCE_ENABLED) void savePreferredConnectionMode(mode);
  }, []);
  const handleSettings = useCallback(() => setScreen({ type: 'settings' }), []);
  const handleHistory = useCallback(() => {
    transitionAnim.stopAnimation();
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setScreen({ type: 'history' });
      Animated.timing(transitionAnim, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, [transitionAnim]);
  const handleHistoryBack = useCallback(() => {
    transitionAnim.stopAnimation();
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 200,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setScreen({ type: 'menu' });
      Animated.timing(transitionAnim, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, [transitionAnim]);

  /** Deliberately walk away from the current room (also cancels a pending
   *  reconnect). The snapshot survives — that's what RESUME GAME is for. */
  const handleLeave = useCallback(() => {
    cancelReconnect();
    disconnect();
    sessionRef.current = null;
    matchIdRef.current = null;
    pendingResumeRef.current = null;
    pendingGameScreenRef.current = null;
    setLobbyFadingOut(false);
    if (PERSISTENCE_ENABLED) void clearSession();
    refreshResumeAvailable();
    setScreen({ type: 'menu' });
  }, [cancelReconnect, disconnect, refreshResumeAvailable]);
  leaveRef.current = handleLeave;

  /** Lobby swipe-to-leave: fade to black, tear down session, fade back in. */
  const handleLobbyLeaveWithFade = useCallback(() => {
    Animated.timing(transitionAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      handleLeave();
      Animated.timing(transitionAnim, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, [handleLeave, transitionAnim]);

  const handleStartGame = useCallback(() => {
    const delay = parseBuzzerDelay(buzzerDelay);
    const resume = pendingResumeRef.current;
    if (resume) {
      transportRef.current?.startGame({
        ...(delay != null ? { buzzerDelay: delay } : {}),
        resume: { state: resume.state, board: resume.board },
      });
      return;
    }
    const id = gameId ? Number(gameId) : null;
    transportRef.current?.startGame({
      ...(id ? { gameId: id } : {}),
      ...(delay != null ? { buzzerDelay: delay } : {}),
    });
  }, [buzzerDelay, gameId]);

  const handleGameLeave = handleLeave;

  /** Host kicks a player from the lobby by sending them a leave message. */
  const handleKickPlayer = useCallback((peerId: string) => {
    transportRef.current?.send(peerId, JSON.stringify({ type: 'LOBBY_KICK' }));
    setLobbyPlayers(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  // Menu-overlay actions: abandon the current session, then do the action.
  const handleOverlayNewGame = useCallback(() => {
    fadeToBlackAndHold(() => {
      cancelReconnect();
      disconnect();
      connectAndDo('create', undefined, connectionMode);
    });
  }, [cancelReconnect, connectAndDo, connectionMode, disconnect, fadeToBlackAndHold]);

  const handleOverlayJoinGame = useCallback((sourceRect?: CellRect) => {
    cancelReconnect();
    disconnect();
    sessionRef.current = null;
    pendingResumeRef.current = null;
    if (PERSISTENCE_ENABLED) void clearSession();
    setJoinError(null);
    setScreen({ type: 'join', sourceRect: sourceRect ?? null });
  }, [cancelReconnect, disconnect]);

  // On launch: restore the saved player name, offer RESUME GAME if an
  // unfinished snapshot exists, and auto-rejoin a still-live session
  // (straight past the menu).
  useEffect(() => {
    if (!PERSISTENCE_ENABLED || UI_LAB) return;
    let stale = false;
    void (async () => {
      const [name, session, snapshot, preferredMode] = await Promise.all([
        loadPlayerName(),
        loadSession(),
        loadSnapshot(),
        loadPreferredConnectionMode(),
      ]);
      if (stale) return;
      if (name) {
        setPlayerName(name);
      } else {
        const fallbackName = randomPlayerName();
        setPlayerName(fallbackName);
        void savePlayerName(fallbackName);
      }
      setResumeAvailable(!!snapshot);
      if (preferredMode) setConnectionMode(preferredMode);
      // Relaunch: our snapshot is stale, so join-first rather than
      // insta-promoting a candidate that could clobber the live game.
      if (session) startReconnectRef.current(session, { promoteDelayMs: RETURNING_GUEST_PROMOTE_MS });
    })();
    return () => { stale = true; };
  }, []);

  // Wake-up awareness: iOS freezes JS while the app is backgrounded, so the
  // socket dies silently. On return to the foreground, if we're mid-game on
  // a dead socket, start rejoining immediately.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      if (
        screenRef.current.type === 'game' &&
        sessionRef.current &&
        transportRef.current?.isClosed
      ) {
        startReconnectRef.current(sessionRef.current, {
          keepGameMounted: canAutoRejoinAfterPeerDisconnect(sessionRef.current),
          // Frozen-in-background state is stale: join the live host first
          // instead of insta-promoting a candidate over it.
          promoteDelayMs: RETURNING_GUEST_PROMOTE_MS,
        });
      }
    });
    return () => sub.remove();
  }, []);


  function renderScreen() {
    switch (screen.type) {
      case 'menu':
        return (
          <MainMenuScreen
            onNewGame={handleNewGame}
            onJoinGame={handleJoinNav}
            onSettings={handleSettings}
            onHistory={handleHistory}
          />
        );
      case 'reconnecting':
        return (
          <ReconnectingScreen
            roomCode={screen.roomCode}
            onCancel={handleLeave}
          />
        );
      case 'join':
        return (
          <View style={styles.screenStack}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <MainMenuScreen
                onNewGame={handleNewGame}
                onJoinGame={handleJoinNav}
                onSettings={handleSettings}
                onHistory={handleHistory}
              />
            </View>
            <View style={StyleSheet.absoluteFill}>
              <JoinGameScreen
                sourceRect={screen.sourceRect}
                onSubmit={handleJoinSubmit}
                onCodeChange={cancelJoinAttempt}
                onBack={() => {
                  cancelJoinAttempt();
                  setScreen({ type: 'menu' });
                }}
                error={joinError}
                searching={joinSearching}
                connectionMode={connectionMode}
              />
            </View>
          </View>
        );
      case 'lobby':
        return (
          <View style={styles.screenStack}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <MainMenuScreen
                onNewGame={handleNewGame}
                onJoinGame={handleJoinNav}
                onSettings={handleSettings}
                onHistory={handleHistory}
              />
            </View>
            <View style={StyleSheet.absoluteFill}>
              <LobbyScreen
                roomCode={screen.roomCode}
                players={lobbyPlayers}
                isHost={screen.isHost}
                onStart={handleStartGame}
                onLeave={handleLobbyLeaveWithFade}
                onNewGame={handleOverlayNewGame}
                onJoinGame={handleOverlayJoinGame}
                playerName={playerName}
                onNameChange={handleNameChange}
                relayHost={relayHost}
                onRelayHostChange={setRelayHost}
                relayPort={relayPort}
                onRelayPortChange={setRelayPort}
                sessionMode={transportRef.current?.mode}
                gameId={gameId}
                onGameIdChange={setGameId}
                buzzerDelay={buzzerDelay}
                onBuzzerDelayChange={setBuzzerDelay}
                animationsEnabled={animationsEnabled}
                onAnimationsChange={setAnimationsEnabled}
                visibleCategories={visibleCategories}
                onVisibleCategoriesChange={setVisibleCategories}
                onKickPlayer={handleKickPlayer}
                error={lobbyError}
                fadeOut={lobbyFadingOut}
                onFadeOutDone={handleLobbyFadeOutDone}
              />
            </View>
          </View>
        );
      case 'game':
        return transportRef.current ? (
          <NetworkedGame
            transport={transportRef.current}
            serverPeerId={screen.serverPeerId}
            initialState={initialGameState}
            boardData={boardData}
            remotePeerConnectionStatus={peerConnectionStatus}
            localIsHost={sessionRef.current?.isHost ?? false}
            localRecovery={localRecovery}
            roomCode={screen.roomCode}
            relayHost={relayHost}
            relayPort={relayPort}
            onLeave={handleGameLeave}
            onNewGame={handleOverlayNewGame}
            onJoinGame={handleOverlayJoinGame}
            onBoardVisible={() => {
              const session = sessionRef.current;
              if (!session || !isLocalSessionMode(session.mode) || session.isHost) return;
              transportRef.current?.send(screen.serverPeerId, JSON.stringify({ type: 'CLIENT_SCREEN_READY' }));
            }}
            playerName={playerName}
            onNameChange={handleNameChange}
            relayHostSetting={relayHost}
            onRelayHostChange={setRelayHost}
            relayPortSetting={relayPort}
            onRelayPortChange={setRelayPort}
            animationsEnabled={animationsEnabled}
            onAnimationsChange={setAnimationsEnabled}
            visibleCategories={visibleCategories}
            onVisibleCategoriesChange={setVisibleCategories}
            isResume={screen.isResume}
            recentMatches={recentMatches}
          />
        ) : null;
      case 'settings':
        return (
          <SettingsScreen
            playerName={playerName}
            onNameChange={handleNameChange}
            relayHost={relayHost}
            onRelayHostChange={setRelayHost}
            relayPort={relayPort}
            onRelayPortChange={setRelayPort}
            connectionMode={connectionMode}
            onConnectionModeChange={handleConnectionModeChange}
            onBack={() => setScreen({ type: 'menu' })}
          />
        );
      case 'history':
        return (
          <MatchHistoryScreen
            matches={recentMatches}
            playerName={playerName}
            onBack={handleHistoryBack}
            onResumeMatch={handleResumeMatch}
          />
        );
      case 'demo':
        return <DemoHarness initialScreen={UI_LAB_SCREEN} />;
    }
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      {fontsLoaded ? (
        <SafeAreaView style={styles.root}>
          {renderScreen()}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.transitionOverlay, { opacity: transitionAnim }]}
          />
        </SafeAreaView>
      ) : (
        <View style={styles.root} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenStack: {
    flex: 1,
    backgroundColor: colors.background,
  },
  transitionOverlay: {
    backgroundColor: colors.background,
  },
});
