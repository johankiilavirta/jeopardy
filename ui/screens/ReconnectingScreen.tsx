import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

interface ReconnectingScreenProps {
  roomCode: number;
  onCancel: () => void;
}

/** Shown while the app tries to get back into a game it was dropped from
 *  (locked phone, backgrounded app, flaky connection). Retries run behind
 *  this screen until they succeed, the room is confirmed gone, or the
 *  player cancels. */
export function ReconnectingScreen(props: ReconnectingScreenProps) {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = setInterval(() => setDots(d => (d % 3) + 1), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.spacer} />
      <Text style={styles.title}>RECONNECTING{'.'.repeat(dots)}</Text>
      <Text style={styles.subtitle}>GAME {props.roomCode}</Text>
      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={props.onCancel}>
          <Text style={styles.buttonText}>CANCEL</Text>
        </Pressable>
      </View>
      <View style={styles.spacer} />
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
  spacer: {
    flex: 1,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 32,
    color: colors.gold,
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.categoryText,
    opacity: 0.7,
    marginBottom: 40,
  },
  buttons: {
    width: '100%',
    maxWidth: 280,
  },
  button: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
});
