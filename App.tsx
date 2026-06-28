import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { createClient } from './src/client';
import type { GameState } from './src/types';
import type { GameData } from './data/gameLoader';
import { WebSocketTransport } from './src/webSocketTransport';
import { DemoHarness } from './ui/demo/DemoHarness';
import { NetworkedGame } from './ui/networked/NetworkedGame';
import { MainMenuScreen } from './ui/screens/MainMenuScreen';
import { JoinGameScreen } from './ui/screens/JoinGameScreen';
import { LobbyScreen, type LobbyPlayer } from './ui/screens/LobbyScreen';

const CONNECTION_TIMEOUT_MS = 7000;
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { colors } from './ui/theme/tokens';

const extra = Constants.expoConfig?.extra as {
  network?: boolean;
  relayHost?: string;
  room?: string;
  players?: string;
  game?: string;
} | undefined;

// Read EXPO_PUBLIC_* directly: Expo inlines these into the (web) client
// bundle at build time, whereas Constants.expoConfig.extra only reliably
// carries them on native. Fall back to extra for native dev.
const DEV_ROOM_RAW = process.env.EXPO_PUBLIC_ROOM ?? extra?.room;
const DEV_PLAYERS_RAW = process.env.EXPO_PUBLIC_PLAYERS ?? extra?.players;
const DEV_GAME_RAW = process.env.EXPO_PUBLIC_GAME ?? extra?.game;

const DEV_ROOM = DEV_ROOM_RAW ? Number(DEV_ROOM_RAW) : null;
// Auto-start once this many players are in the room (default 1 = solo: drop
// straight into the game). Set EXPO_PUBLIC_PLAYERS=2 and open a second tab for
// a multiplayer dev session.
const DEV_PLAYERS = DEV_PLAYERS_RAW ? Math.max(1, Number(DEV_PLAYERS_RAW)) : 1;
// Optional J!Archive game number to load for the dev session.
const DEV_GAME = DEV_GAME_RAW ? Number(DEV_GAME_RAW) : null;
const DEFAULT_RELAY_HOST = process.env.EXPO_PUBLIC_RELAY_HOST ?? extra?.relayHost ?? 'localhost';

type AppScreen =
  | { type: 'menu' }
  | { type: 'join' }
  | { type: 'lobby'; roomCode: number; isHost: boolean }
  | { type: 'game'; serverPeerId: string; roomCode: number }
  | { type: 'settings' }
  | { type: 'demo' };

function randomPlayerName(): string {
  return `Player ${String(Math.floor(1000 + Math.random() * 9000))}`;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Oswald_500Medium,
    Oswald_700Bold,
  });

  const [screen, setScreen] = useState<AppScreen>({ type: 'menu' });
  const [playerName, setPlayerName] = useState(randomPlayerName);
  const [relayHost, setRelayHost] = useState(DEFAULT_RELAY_HOST);
  const [relayPort, setRelayPort] = useState('8787');
  const [gameId, setGameId] = useState('');
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [initialGameState, setInitialGameState] = useState<{ state: GameState; playerId: string | null } | null>(null);
  const [boardData, setBoardData] = useState<GameData | null>(null);
  const [peerDisconnected, setPeerDisconnected] = useState(false);
  const transportRef = useRef<WebSocketTransport | null>(null);
  const myPeerIdRef = useRef<string | null>(null);
  const devAutoStartedRef = useRef(false);

  const disconnect = useCallback(() => {
    transportRef.current?.stop();
    transportRef.current = null;
    myPeerIdRef.current = null;
    setLobbyPlayers([]);
    setLobbyError(null);
  }, []);

  /** Connect to relay and create or join a room. */
  const connectAndDo = useCallback((action: 'create' | { join: number }) => {
    disconnect();
    setLobbyError(null);
    setJoinError(null);
    setPeerDisconnected(false);

    let roomCode = action !== 'create' ? action.join : 0;

    // For create, navigate to lobby right away (connection in background).
    // For join, stay on the join screen until we confirm the room exists.
    if (action === 'create') {
      setScreen({ type: 'lobby', roomCode: 0, isHost: true });
    }

    const url = `ws://${relayHost}:${relayPort}`;
    const transport = new WebSocketTransport(url);
    transportRef.current = transport;

    transport.onError((err) => {
      if (action !== 'create') {
        setJoinError(err);
      } else {
        setLobbyError(err);
      }
    });

    transport.onPeerDisconnected(() => {
      setPeerDisconnected(true);
    });

    transport.onPeerConnected(() => {
      setPeerDisconnected(false);
    });

    // Time out if we don't get a welcome within 7 seconds
    const timeout = setTimeout(() => {
      if (!myPeerIdRef.current) {
        const err = 'Could not connect to relay';
        if (action !== 'create') {
          setJoinError(err);
        } else {
          setLobbyError(err);
        }
        transport.stop();
      }
    }, CONNECTION_TIMEOUT_MS);

    transport.onRawMessage((msg) => {
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
        case 'game-started':
          // Register message handler BEFORE React re-renders so no
          // STATE_UPDATE messages are lost to the void.
          createClient(transport, (state, pid) => {
            setInitialGameState({ state, playerId: pid });
          });
          setBoardData((msg.board as GameData) ?? null);
          setScreen({
            type: 'game',
            serverPeerId: msg.serverPeerId as string,
            roomCode,
          });
          break;
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
        transport.sendRaw({ type: 'create-room', playerName });
      } else {
        transport.sendRaw({ type: 'join-room', roomCode: action.join, playerName });
      }
    });
  }, [relayHost, relayPort, playerName, disconnect]);

  // Dev shortcut: auto-create or join room
  useEffect(() => {
    if (DEV_ROOM == null || devAutoStartedRef.current) return;
    devAutoStartedRef.current = true;
    const url = `ws://${relayHost}:${relayPort}`;
    const transport = new WebSocketTransport(url);
    transportRef.current = transport;

    transport.onRawMessage((msg) => {
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
            transport.sendRaw({ type: 'start-game', ...(DEV_GAME ? { gameId: DEV_GAME } : {}) });
          }
          break;
        }
        case 'game-started':
          createClient(transport, (state, pid) => {
            setInitialGameState({ state, playerId: pid });
          });
          setBoardData((msg.board as GameData) ?? null);
          setScreen({ type: 'game', serverPeerId: msg.serverPeerId as string, roomCode: DEV_ROOM });
          break;
        case 'room-error':
          if (msg.message === 'Room not found') {
            // Recreate the room at the same fixed dev code so a second tab
            // (EXPO_PUBLIC_PLAYERS=2) can deterministically join it.
            transport.sendRaw({ type: 'create-room', playerName, roomCode: DEV_ROOM });
          } else {
            setLobbyError(msg.message as string);
          }
          break;
      }
    });

    transport.ready.then((peerId) => {
      myPeerIdRef.current = peerId;
      transport.sendRaw({ type: 'join-room', roomCode: DEV_ROOM, playerName });
      setScreen({ type: 'lobby', roomCode: DEV_ROOM, isHost: false });
    });
  }, []);

  const handleNewGame = useCallback(() => connectAndDo('create'), [connectAndDo]);

  const handleJoinNav = useCallback(() => {
    setLobbyError(null);
    setJoinError(null);
    setScreen({ type: 'join' });
  }, []);

  const handleJoinSubmit = useCallback((code: number) => connectAndDo({ join: code }), [connectAndDo]);
  const handleSettings = useCallback(() => setScreen({ type: 'settings' }), []);

  const handleLeave = useCallback(() => {
    disconnect();
    setScreen({ type: 'menu' });
  }, [disconnect]);

  const handleStartGame = useCallback(() => {
    const id = gameId ? Number(gameId) : null;
    transportRef.current?.sendRaw({ type: 'start-game', ...(id ? { gameId: id } : {}) });
  }, [gameId]);

  const handleGameLeave = useCallback(() => {
    disconnect();
    setScreen({ type: 'menu' });
  }, [disconnect]);

  // Menu-overlay actions: disconnect the current session, then do the action.
  const handleOverlayNewGame = useCallback(() => {
    disconnect();
    connectAndDo('create');
  }, [disconnect, connectAndDo]);

  const handleOverlayJoinGame = useCallback(() => {
    disconnect();
    setJoinError(null);
    setScreen({ type: 'join' });
  }, [disconnect]);


  function renderScreen() {
    switch (screen.type) {
      case 'menu':
        return (
          <MainMenuScreen
            onNewGame={handleNewGame}
            onJoinGame={handleJoinNav}
            onSettings={handleSettings}
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
            onNameChange={setPlayerName}
            relayHost={relayHost}
            onRelayHostChange={setRelayHost}
            relayPort={relayPort}
            onRelayPortChange={setRelayPort}
            gameId={gameId}
            onGameIdChange={setGameId}
            animationsEnabled={animationsEnabled}
            onAnimationsChange={setAnimationsEnabled}
            error={lobbyError}
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
            onNameChange={setPlayerName}
            relayHostSetting={relayHost}
            onRelayHostChange={setRelayHost}
            relayPortSetting={relayPort}
            onRelayPortChange={setRelayPort}
            animationsEnabled={animationsEnabled}
          />
        ) : null;
      case 'settings':
        return (
          <SettingsScreen
            playerName={playerName}
            onNameChange={setPlayerName}
            relayHost={relayHost}
            onRelayHostChange={setRelayHost}
            relayPort={relayPort}
            onRelayPortChange={setRelayPort}
            onBack={() => setScreen({ type: 'menu' })}
          />
        );
      case 'demo':
        return <DemoHarness />;
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
