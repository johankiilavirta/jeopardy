import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

export interface LobbyPlayer {
  peerId: string;
  name: string;
  isHost: boolean;
}

interface LobbyScreenProps {
  roomCode: number;
  players: LobbyPlayer[];
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
}

export function LobbyScreen(props: LobbyScreenProps) {
  const canStart = props.isHost && props.players.length >= 2;

  return (
    <View style={styles.root}>
      <Pressable style={styles.leaveButton} onPress={props.onLeave}>
        <Text style={styles.leaveText}>← LEAVE</Text>
      </Pressable>

      <Text style={styles.roomCode}>{props.roomCode}</Text>
      <Text style={styles.subtitle}>Share this code with your friend</Text>

      <View style={styles.playerList}>
        {props.players.map(p => (
          <View key={p.peerId} style={styles.playerRow}>
            <Text style={styles.playerName}>{p.name}</Text>
            {p.isHost && <Text style={styles.hostBadge}>HOST</Text>}
          </View>
        ))}
        {props.players.length < 2 && (
          <View style={styles.playerRow}>
            <Text style={styles.waitingText}>Waiting for player...</Text>
          </View>
        )}
      </View>

      {props.isHost && (
        <Pressable
          style={[styles.startButton, !canStart && styles.startButtonDisabled]}
          onPress={props.onStart}
          disabled={!canStart}
        >
          <Text style={[styles.startButtonText, !canStart && styles.startButtonTextDisabled]}>
            START GAME
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  leaveButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
  },
  leaveText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.gold,
  },
  roomCode: {
    fontFamily: typeTokens.board,
    fontSize: 72,
    color: colors.gold,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#888',
    marginBottom: 32,
  },
  playerList: {
    width: '100%',
    maxWidth: 280,
    gap: 8,
    marginBottom: 32,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 6,
  },
  playerName: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    color: '#fff',
    flex: 1,
  },
  hostBadge: {
    fontFamily: typeTokens.ui700,
    fontSize: 12,
    color: colors.gold,
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  waitingText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#555',
    fontStyle: 'italic',
  },
  startButton: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 6,
  },
  startButtonDisabled: {
    opacity: 0.4,
  },
  startButtonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
  startButtonTextDisabled: {
    color: '#666',
  },
});
