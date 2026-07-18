import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
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
import { connectionModeForRoomCode } from './app/roomCodes';
import type { SessionMode, SessionProvider } from './app/sessionProvider';
import { DemoHarness } from './ui/demo/DemoHarness';
import { NetworkedGame } from './ui/networked/NetworkedGame';
import { MainMenuScreen } from './ui/screens/MainMenuScreen';
import { JoinGameScreen } from './ui/screens/JoinGameScreen';
import { NewGameScreen } from './ui/screens/NewGameScreen';
import { LobbyScreen, type LobbyPlayer } from './ui/screens/LobbyScreen';
import { ReconnectingScreen } from './ui/screens/ReconnectingScreen';
import {
  clearSession,
  clearSnapshot,
  loadPlayerName,
  loadSession,
  loadSnapshot,
  savePlayerName,
  saveSession,
  saveSnapshotBoard,
  saveSnapshotState,
  type SavedSession,
  type SavedSnapshot,
} from './app/sessionStore';

const CONNECTION_TIMEOUT_MS = 7000;
const RECONNECT_RETRY_MS = 3000;
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { colors } from './ui/theme/tokens';

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
const DEFAULT_RELAY_HOST = process.env.EXPO_PUBLIC_RELAY_HOST ?? extra?.relayHost ?? 'localhost';

// Session/snapshot persistence and auto-rejoin are disabled in dev
// auto-start mode — the fixed DEV_ROOM flow owns the lifecycle there.
const PERSISTENCE_ENABLED = DEV_ROOM == null;

type AppScreen =
  | { type: 'menu' }
  | { type: 'new' }
  | { type: 'join' }
  | { type: 'lobby'; roomCode: number; isHost: boolean }
  | { type: 'game'; serverPeerId: string; roomCode: number; isResume?: boolean }
  | { type: 'reconnecting'; roomCode: number }
  | { type: 'settings' }
  | { type: 'demo' };

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

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Oswald_500Medium,
    Oswald_700Bold,
  });

  const [screen, setScreen] = useState<AppScreen>(() => (UI_LAB ? { type: 'demo' } : { type: 'menu' }));
  const [playerName, setPlayerName] = useState('');
  const [relayHost, setRelayHost] = useState(DEFAULT_RELAY_HOST);
  const [relayPort, setRelayPort] = useState('8787');
  const [gameId, setGameId] = useState('');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [visibleCategories, setVisibleCategories] = useState(6);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [initialGameState, setInitialGameState] = useState<{ state: GameState; playerId: string | null; canUndo?: boolean; canRedo?: boolean } | null>(null);
  const [boardData, setBoardData] = useState<GameData | null>(null);
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const transportRef = useRef<SessionProvider | null>(null);
  const myPeerIdRef = useRef<string | null>(null);
  const devAutoStartedRef = useRef(false);

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
  const reconnectCtlRef = useRef<{ cancelled: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const startReconnectRef = useRef<(session: SavedSession) => void>(() => {});

  const disconnect = useCallback(() => {
    transportRef.current?.stop();
    transportRef.current = null;
    myPeerIdRef.current = null;
    setLobbyPlayers([]);
    setLobbyError(null);
  }, []);

  const cancelReconnect = useCallback(() => {
    const ctl = reconnectCtlRef.current;
    if (!ctl) return;
    ctl.cancelled = true;
    if (ctl.timer != null) clearTimeout(ctl.timer);
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
    } else {
      saveSnapshotState(state);
    }
  }, []);

  /** The socket died while on the game screen — get back in. */
  const handleSocketLost = useCallback(() => {
    if (!PERSISTENCE_ENABLED) return;
    if (screenRef.current.type === 'game' && sessionRef.current) {
      startReconnectRef.current(sessionRef.current);
    }
  }, []);

  const handlePeerDisconnected = useCallback(() => {
    const session = sessionRef.current;
    if (
      PERSISTENCE_ENABLED &&
      screenRef.current.type === 'game' &&
      session &&
      canAutoRejoinAfterPeerDisconnect(session)
    ) {
      startReconnectRef.current(session);
      return;
    }
    setPeerDisconnected(true);
  }, []);

  /** Rejoin a live room, retrying until it works, the relay says the room
   *  is gone, or the player cancels from the Reconnecting screen. */
  const startReconnect = useCallback((session: SavedSession) => {
    cancelReconnect();
    disconnect();
    setPeerDisconnected(false);

    // Local hosts can't rejoin: the authoritative server ran inside this
    // app's JS process and died with it. RESUME GAME (seeding a fresh room
    // with the snapshot) is the path back.
    if ((session.mode === 'nearby' || session.mode === 'bluetooth') && session.isHost) {
      sessionRef.current = null;
      void clearSession();
      refreshResumeAvailable();
      setScreen({ type: 'menu' });
      return;
    }

    const ctl = { cancelled: false, timer: null as ReturnType<typeof setTimeout> | null };
    reconnectCtlRef.current = ctl;
    setScreen({ type: 'reconnecting', roomCode: session.roomCode });

    const giveUp = () => {
      if (ctl.cancelled) return;
      ctl.cancelled = true;
      reconnectCtlRef.current = null;
      transportRef.current?.stop();
      transportRef.current = null;
      sessionRef.current = null;
      void clearSession();
      refreshResumeAvailable();
      setScreen({ type: 'menu' });
    };

    const attempt = () => {
      if (ctl.cancelled) return;
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
        if (ctl.cancelled || settled) return;
        settled = true;
        transport.stop();
        ctl.timer = setTimeout(attempt, RECONNECT_RETRY_MS);
      };

      const welcomeTimeout = setTimeout(retry, CONNECTION_TIMEOUT_MS);
      transport.onError(() => {
        if (!settled) retry();
        else handleSocketLost();
      });
      transport.onPeerDisconnected(handlePeerDisconnected);
      transport.onPeerConnected(() => setPeerDisconnected(false));

      transport.onControlMessage((msg) => {
        if (ctl.cancelled) return;
        switch (msg.type) {
          case 'game-started': {
            settled = true;
            clearTimeout(welcomeTimeout);
            reconnectCtlRef.current = null;
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
              }
            });
            const board = (msg.board as GameData) ?? null;
            if (board) {
              setBoardData(board);
              void saveSnapshotBoard(board, session.mode);
            }
            sessionRef.current = session;
            void saveSession(session);
            break;
          }
          case 'lobby-update':
            // The code exists as a lobby again (e.g. the relay restarted
            // and the other player re-created the room). Join it normally.
            settled = true;
            clearTimeout(welcomeTimeout);
            reconnectCtlRef.current = null;
            setLobbyPlayers(msg.players as LobbyPlayer[]);
            setScreen({ type: 'lobby', roomCode: session.roomCode, isHost: false });
            break;
          case 'room-error':
            // Room not found (or full) — nothing left to rejoin.
            settled = true;
            clearTimeout(welcomeTimeout);
            giveUp();
            break;
        }
      });

      transport.ready.then((peerId) => {
        if (ctl.cancelled) return;
        myPeerIdRef.current = peerId;
        transport.joinRoom(session.roomCode, session.playerName);
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
  ) => {
    cancelReconnect();
    disconnect();
    pendingResumeRef.current = resume ?? null;
    pendingGameScreenRef.current = null;
    setLobbyFadingOut(false);
    sessionRef.current = null;
    if (PERSISTENCE_ENABLED) void clearSession();
    setLobbyError(null);
    setJoinError(null);
    setPeerDisconnected(false);

    let roomCode = action !== 'create' ? action.join : 0;

    // For create, navigate to lobby right away (connection in background).
    // For join, stay on the join screen until we confirm the room exists.
    if (action === 'create') {
      setScreen({ type: 'lobby', roomCode: 0, isHost: true });
    }

    const transport = createSessionProvider(
      mode,
      action === 'create' ? 'host' : 'guest',
      relayUrls(relayHost, relayPort).ws,
    );
    transportRef.current = transport;

    transport.onError((err) => {
      // Mid-game socket loss is handled by the rejoin loop, not an error label.
      if (screenRef.current.type === 'game') {
        handleSocketLost();
        return;
      }
      if (action !== 'create') {
        setJoinError(err);
      } else {
        setLobbyError(err);
      }
    });

    transport.onPeerDisconnected(handlePeerDisconnected);

    transport.onPeerConnected(() => {
      setPeerDisconnected(false);
    });

    // Time out if we don't get a welcome within 7 seconds
    const timeout = setTimeout(() => {
      if (!myPeerIdRef.current) {
        const err = connectionTimeoutMessage(mode);
        if (action !== 'create') {
          setJoinError(err);
        } else {
          setLobbyError(err);
        }
        transport.stop();
      }
    }, CONNECTION_TIMEOUT_MS);

    transport.onControlMessage((msg) => {
      switch (msg.type) {
        case 'room-created':
          roomCode = msg.roomCode as number;
          setScreen({
            type: 'lobby',
            roomCode,
            isHost: true,
          });
          setLobbyError(null);
          break;
        case 'lobby-update':
          setLobbyPlayers(msg.players as LobbyPlayer[]);
          setLobbyError(null);
          // If we were on the join screen, now navigate to lobby
          if (action !== 'create') {
            const roomCode = typeof action === 'object' ? action.join : 0;
            setScreen({ type: 'lobby', roomCode, isHost: false });
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
          if (PERSISTENCE_ENABLED) {
            const session = { mode, roomCode, playerName, relayHost, relayPort, isHost: action === 'create' };
            sessionRef.current = { ...session, savedAt: Date.now() };
            void saveSession(session);
            void saveSnapshotBoard(board, mode);
          }
          break;
        }
        case 'room-error':
          if (action !== 'create') {
            setJoinError(msg.message as string);
          } else {
            setLobbyError(msg.message as string);
          }
          break;
      }
    });

    transport.ready.then((peerId) => {
      clearTimeout(timeout);
      myPeerIdRef.current = peerId;
      if (action === 'create') {
        transport.createRoom(playerName);
      } else {
        transport.joinRoom(action.join, playerName);
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not start session';
      if (action === 'create') setLobbyError(message);
      else setJoinError(message);
    });
  }, [relayHost, relayPort, playerName, disconnect, cancelReconnect, handleStateUpdate, handleSocketLost, handlePeerDisconnected]);

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
        case 'game-started':
          createClient(transport, (state, pid, cu, cr) => {
            handleStateUpdate(state, pid, cu, cr);
          });
          setBoardData((msg.board as GameData) ?? null);
          setScreen({ type: 'game', serverPeerId: msg.serverPeerId as string, roomCode: DEV_ROOM });
          break;
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

  const handleNewGame = useCallback(() => setScreen({ type: 'new' }), []);
  const handleBluetoothNewGame = useCallback(() => connectAndDo('create', undefined, 'bluetooth'), [connectAndDo]);
  const handleNearbyNewGame = useCallback(() => connectAndDo('create', undefined, 'nearby'), [connectAndDo]);
  const handleOnlineNewGame = useCallback(() => connectAndDo('create'), [connectAndDo]);

  /** RESUME GAME: host a fresh room seeded with the snapshot on this device. */
  const handleResumeGame = useCallback(() => {
    void loadSnapshot().then((snapshot) => {
      if (!snapshot) {
        setResumeAvailable(false);
        return;
      }
      // Either device may become the new host — both hold snapshots.
      connectAndDo('create', snapshot, snapshot.mode);
    });
  }, [connectAndDo]);

  const handleNameChange = useCallback((name: string) => {
    setPlayerName(name);
    if (PERSISTENCE_ENABLED) void savePlayerName(name);
  }, []);

  const handleJoinNav = useCallback(() => {
    setLobbyError(null);
    setJoinError(null);
    setScreen({ type: 'join' });
  }, []);

  const handleJoinSubmit = useCallback((code: number) => {
    const mode = connectionModeForRoomCode(code);
    if (mode === 'online') {
      connectAndDo({ join: code });
      return;
    }
    if (mode === 'bluetooth') {
      connectAndDo({ join: code }, undefined, 'bluetooth');
      return;
    }
    if (mode === 'nearby') {
      connectAndDo({ join: code }, undefined, 'nearby');
      return;
    }
    setJoinError('Enter a room code from 100 to 999');
  }, [connectAndDo]);
  const handleSettings = useCallback(() => setScreen({ type: 'settings' }), []);

  /** Deliberately walk away from the current room (also cancels a pending
   *  reconnect). The snapshot survives — that's what RESUME GAME is for. */
  const handleLeave = useCallback(() => {
    cancelReconnect();
    disconnect();
    sessionRef.current = null;
    pendingResumeRef.current = null;
    pendingGameScreenRef.current = null;
    setLobbyFadingOut(false);
    if (PERSISTENCE_ENABLED) void clearSession();
    refreshResumeAvailable();
    setScreen({ type: 'menu' });
  }, [cancelReconnect, disconnect, refreshResumeAvailable]);

  const handleStartGame = useCallback(() => {
    const resume = pendingResumeRef.current;
    if (resume) {
      transportRef.current?.startGame({
        resume: { state: resume.state, board: resume.board },
      });
      return;
    }
    const id = gameId ? Number(gameId) : null;
    transportRef.current?.startGame(id ? { gameId: id } : undefined);
  }, [gameId]);

  const handleGameLeave = handleLeave;

  // Menu-overlay actions: abandon the current session, then do the action.
  const handleOverlayNewGame = useCallback(() => {
    cancelReconnect();
    disconnect();
    setScreen({ type: 'new' });
  }, [cancelReconnect, disconnect]);

  const handleOverlayJoinGame = useCallback(() => {
    cancelReconnect();
    disconnect();
    sessionRef.current = null;
    pendingResumeRef.current = null;
    if (PERSISTENCE_ENABLED) void clearSession();
    setJoinError(null);
    setScreen({ type: 'join' });
  }, [cancelReconnect, disconnect]);

  // On launch: restore the saved player name, offer RESUME GAME if an
  // unfinished snapshot exists, and auto-rejoin a still-live session
  // (straight past the menu).
  useEffect(() => {
    if (!PERSISTENCE_ENABLED || UI_LAB) return;
    let stale = false;
    void (async () => {
      const [name, session, snapshot] = await Promise.all([
        loadPlayerName(),
        loadSession(),
        loadSnapshot(),
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
      if (session) startReconnectRef.current(session);
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
        startReconnectRef.current(sessionRef.current);
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
            onResumeGame={resumeAvailable ? handleResumeGame : undefined}
          />
        );
      case 'new':
        return (
          <NewGameScreen
            onBluetooth={handleBluetoothNewGame}
            onNearby={handleNearbyNewGame}
            onOnline={handleOnlineNewGame}
            onBack={() => setScreen({ type: 'menu' })}
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
          <JoinGameScreen
            onSubmit={handleJoinSubmit}
            onBack={() => setScreen({ type: 'menu' })}
            error={joinError}
          />
        );
      case 'lobby':
        return (
          <LobbyScreen
            roomCode={screen.roomCode}
            players={lobbyPlayers}
            isHost={screen.isHost}
            onStart={handleStartGame}
            onLeave={handleLeave}
            onNewGame={handleOverlayNewGame}
            onJoinGame={handleOverlayJoinGame}
            playerName={playerName}
            onNameChange={handleNameChange}
            relayHost={relayHost}
            onRelayHostChange={setRelayHost}
            relayPort={relayPort}
            onRelayPortChange={setRelayPort}
            gameId={gameId}
            onGameIdChange={setGameId}
            animationsEnabled={animationsEnabled}
            onAnimationsChange={setAnimationsEnabled}
            visibleCategories={visibleCategories}
            onVisibleCategoriesChange={setVisibleCategories}
            error={lobbyError}
            fadeOut={lobbyFadingOut}
            onFadeOutDone={handleLobbyFadeOutDone}
          />
        );
      case 'game':
        return transportRef.current ? (
          <NetworkedGame
            transport={transportRef.current}
            serverPeerId={screen.serverPeerId}
            initialState={initialGameState}
            boardData={boardData}
            peerDisconnected={peerDisconnected}
            roomCode={screen.roomCode}
            relayHost={relayHost}
            relayPort={relayPort}
            onLeave={handleGameLeave}
            onNewGame={handleOverlayNewGame}
            onJoinGame={handleOverlayJoinGame}
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
            onBack={() => setScreen({ type: 'menu' })}
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
    backgroundColor: colors.bg,
  },
});
