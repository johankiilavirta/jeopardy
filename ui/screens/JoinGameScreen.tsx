import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NumberKeyboard } from '../components/NumberKeyboard';
import { colors, type as typeTokens } from '../theme/tokens';

interface JoinGameScreenProps {
  onSubmit: (roomCode: number) => void;
  onBack: () => void;
  error: string | null;
}

export function JoinGameScreen(props: JoinGameScreenProps) {
  const [code, setCode] = useState('');
  const valid = /^\d{3}$/.test(code);

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={props.onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>

      <Text style={styles.title}>JOIN GAME</Text>

      <Text style={styles.subtitle}>Enter 3-digit room code</Text>

      <View style={styles.codeInput} accessibilityLabel={`Room code ${code || 'empty'}`}>
        <Text style={[styles.codeText, !code && styles.codePlaceholder]}>
          {code.padEnd(3, '0')}
        </Text>
      </View>

      <View style={styles.keypad}>
        <NumberKeyboard
          dark
          onInsert={digit => setCode(current => `${current}${digit}`.slice(0, 3))}
          onBackspace={() => setCode(current => current.slice(0, -1))}
        />
      </View>

      <Pressable
        style={[styles.joinButton, !valid && styles.joinButtonDisabled]}
        onPress={() => valid && props.onSubmit(Number(code))}
        disabled={!valid}
      >
        <Text style={[styles.joinButtonText, !valid && styles.joinButtonTextDisabled]}>
          JOIN
        </Text>
      </Pressable>

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
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
    zIndex: 1,
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
    borderWidth: 2,
    borderColor: '#444',
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
    textAlign: 'center',
    letterSpacing: 16,
    width: 200,
  },
  codeText: {
    fontFamily: typeTokens.board,
    fontSize: 48,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 16,
  },
  codePlaceholder: {
    color: '#444',
  },
  keypad: {
    width: '100%',
    maxWidth: 320,
    height: 240,
    marginTop: 18,
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
  joinButton: {
    marginTop: 18,
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
