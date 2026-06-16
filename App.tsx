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
import { WebSocketTransport } from './src/webSocketTransport';
import { DemoHarness } from './ui/demo/DemoHarness';
import { NetworkedGame } from './ui/networked/NetworkedGame';
import { MainMenuScreen } from './ui/screens/MainMenuScreen';
import { JoinGameScreen } from './ui/screens/JoinGameScreen';
import { LobbyScreen, type LobbyPlayer } from './ui/screens/LobbyScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { colors } from './ui/theme/tokens';

const extra = Constants.expoConfig?.extra as {
  network?: boolean;
  relayHost?: string;
  room?: string;
} | undefined;

const DEV_ROOM = extra?.room ? Number(extra.room) : null;
const DEFAULT_RELAY_HOST = extra?.relayHost ?? 'localhost';

type AppScreen =
  | { type: 'menu' }
  | { type: 'join' }
  | { type: 'lobby'; roomCode: number; isHost: boolean }
  | { type: 'game'; serverPeerId: string }
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
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [joinRoomCode, setJoinRoomCode] = useState('');
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

  const connectAndDo = useCallback((action: 'create' | { join: number }) => {
    disconnect();
    const url = `ws://${relayHost}:${relayPort}`;
    const transport = new WebSocketTransport(url);
    transportRef.current = transport;

    transport.onRawMessage((msg) => {
      switch (msg.type) {
        case 'room-created':
          setScreen({
            type: 'lobby',
            roomCode: msg.roomCode as number,
            isHost: true,
          });
          setLobbyError(null);
          break;
        case 'lobby-update':
          setLobbyPlayers(msg.players as LobbyPlayer[]);
          setLobbyError(null);
          break;
        case 'game-started':
          setScreen({
            type: 'game',
            serverPeerId: msg.serverPeerId as string,
          });
          break;
        case 'room-error':
          setLobbyError(msg.message as string);
          break;
      }
    });

    transport.ready.then((peerId) => {
      myPeerIdRef.current = peerId;
      if (action === 'create') {
        transport.sendRaw({ type: 'create-room', playerName });
      } else {
        transport.sendRaw({ type: 'join-room', roomCode: action.join, playerName });
        setScreen({ type: 'lobby', roomCode: action.join, isHost: false });
      }
    });
  }, [relayHost, relayPort, playerName, disconnect]);

  // Dev shortcut: auto-create or join room
  useEffect(() => {
    if (DEV_ROOM == null || devAutoStartedRef.current) return;
    devAutoStartedRef.current = true;
    // Try to create the room; if it already exists the relay will error
    // and we'll fall back to joining.
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
          // Auto-start when 2 players (host only)
          const players = msg.players as LobbyPlayer[];
          const myPeerId = myPeerIdRef.current;
          const me = players.find(p => p.peerId === myPeerId);
          if (players.length >= 2 && me?.isHost) {
            transport.sendRaw({ type: 'start-game' });
          }
          break;
        }
        case 'game-started':
          setScreen({ type: 'game', serverPeerId: msg.serverPeerId as string });
          break;
        case 'room-error':
          // Room already exists or other error — try joining
          if (msg.message === 'Room not found') {
            // Room doesn't exist yet; create it
            transport.sendRaw({ type: 'create-room', playerName });
          } else {
            setLobbyError(msg.message as string);
          }
          break;
      }
    });

    transport.ready.then((peerId) => {
      myPeerIdRef.current = peerId;
      // Try joining first (another sim may have created it)
      transport.sendRaw({ type: 'join-room', roomCode: DEV_ROOM, playerName });
      setScreen({ type: 'lobby', roomCode: DEV_ROOM, isHost: false });
    });
  }, []);

  const handleNewGame = useCallback(() => connectAndDo('create'), [connectAndDo]);
  const handleJoinNav = useCallback(() => {
    setJoinRoomCode('');
    setLobbyError(null);
    setScreen({ type: 'join' });
  }, []);
  const handleJoinSubmit = useCallback((code: number) => connectAndDo({ join: code }), [connectAndDo]);
  const handleSettings = useCallback(() => setScreen({ type: 'settings' }), []);

  const handleLeave = useCallback(() => {
    disconnect();
    setScreen({ type: 'menu' });
  }, [disconnect]);

  const handleStartGame = useCallback(() => {
    transportRef.current?.sendRaw({ type: 'start-game' });
  }, []);

  const handleGameLeave = useCallback(() => {
    disconnect();
    setScreen({ type: 'menu' });
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
            roomCode={joinRoomCode}
            onRoomCodeChange={setJoinRoomCode}
            onSubmit={handleJoinSubmit}
            onBack={() => { disconnect(); setScreen({ type: 'menu' }); }}
            error={lobbyError}
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
          />
        );
      case 'game':
        return transportRef.current ? (
          <NetworkedGame
            transport={transportRef.current}
            serverPeerId={screen.serverPeerId}
            onLeave={handleGameLeave}
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
