import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

interface JoinGameScreenProps {
  onSubmit: (roomCode: number) => void;
  onBack: () => void;
  error: string | null;
  roomCode: string;
  onRoomCodeChange: (code: string) => void;
}

export function JoinGameScreen(props: JoinGameScreenProps) {
  const valid = /^\d{3}$/.test(props.roomCode);

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={props.onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>

      <Text style={styles.title}>JOIN GAME</Text>

      <Text style={styles.subtitle}>Enter 3-digit room code</Text>

      <TextInput
        style={styles.codeInput}
        value={props.roomCode}
        onChangeText={text => {
          const digits = text.replace(/\D/g, '').slice(0, 3);
          props.onRoomCodeChange(digits);
        }}
        keyboardType="number-pad"
        maxLength={3}
        placeholder="000"
        placeholderTextColor="#444"
        autoFocus
      />

      {props.error && <Text style={styles.error}>{props.error}</Text>}

      <Pressable
        style={[styles.joinButton, !valid && styles.joinButtonDisabled]}
        onPress={() => valid && props.onSubmit(Number(props.roomCode))}
        disabled={!valid}
      >
        <Text style={[styles.joinButtonText, !valid && styles.joinButtonTextDisabled]}>
          JOIN
        </Text>
      </Pressable>
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
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
  },
  backText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.gold,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.gold,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#888',
    marginBottom: 24,
  },
  codeInput: {
    fontFamily: typeTokens.board,
    fontSize: 48,
    color: '#fff',
    borderWidth: 2,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    textAlign: 'center',
    letterSpacing: 16,
    width: 200,
  },
  error: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#E55',
    marginTop: 12,
  },
  joinButton: {
    marginTop: 24,
    backgroundColor: colors.cell,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 6,
  },
  joinButtonDisabled: {
    opacity: 0.4,
  },
  joinButtonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
  joinButtonTextDisabled: {
    color: '#666',
  },
});
