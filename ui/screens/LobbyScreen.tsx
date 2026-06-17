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
  error?: string | null;
}

const MAX_PLAYERS = 2;

export function LobbyScreen(props: LobbyScreenProps) {
  const canStart = props.isHost && props.players.length >= MAX_PLAYERS;

  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => props.players[i] ?? null);

  return (
    <View style={styles.root}>
      <Pressable style={styles.leaveButton} onPress={props.onLeave}>
        <Text style={styles.leaveText}>← LEAVE</Text>
      </Pressable>

      {props.roomCode > 0 ? (
        <>
          <Text style={styles.roomCode}>{props.roomCode}</Text>
          <Text style={styles.subtitle}>Share this code with your friend</Text>
        </>
      ) : (
        <>
          <Text style={styles.creatingText}>Creating room...</Text>
          <Text style={styles.subtitle}> </Text>
        </>
      )}

      <View style={styles.playerList}>
        {slots.map((player, i) => (
          <View key={player?.peerId ?? `empty-${i}`} style={styles.playerRow}>
            <Text style={styles.slotLabel}>P{i + 1}</Text>
            {player ? (
              <>
                <Text style={styles.playerName}>{player.name}</Text>
                {player.isHost && <Text style={styles.hostBadge}>HOST</Text>}
              </>
            ) : (
              <Text style={styles.emptySlot}>Open</Text>
            )}
          </View>
        ))}
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

      {props.error && (
        <View style={styles.statusLineWrap}>
          <Text style={styles.statusLine}>{props.error}</Text>
        </View>
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
    zIndex: 1,
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
  slotLabel: {
    fontFamily: typeTokens.ui700,
    fontSize: 14,
    color: '#555',
    marginRight: 12,
  },
  playerName: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    color: '#fff',
    flex: 1,
  },
  emptySlot: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    color: '#444',
    fontStyle: 'italic',
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
  creatingText: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.gold,
    marginBottom: 4,
  },
  statusLineWrap: {
    position: 'absolute',
    left: 24,
    bottom: 20,
    height: 40,
    justifyContent: 'center',
  },
  statusLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.65)',
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
