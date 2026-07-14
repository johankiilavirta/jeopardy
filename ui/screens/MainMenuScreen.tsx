import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

interface MainMenuScreenProps {
  onNewGame: () => void;
  onJoinGame: () => void;
  onSettings: () => void;
  /** Present when an unfinished game snapshot is saved on this device. */
  onResumeGame?: (() => void) | undefined;
}

export function MainMenuScreen(props: MainMenuScreenProps) {
  return (
    <View style={styles.root}>
      <View style={styles.spacer} />
      <Text style={styles.title}>JEOPARDY</Text>
      <View style={styles.buttons}>
        {props.onResumeGame && (
          <Pressable style={[styles.button, styles.resumeButton]} onPress={props.onResumeGame}>
            <Text style={styles.buttonText}>RESUME GAME</Text>
          </Pressable>
        )}
        <Pressable style={styles.button} onPress={props.onNewGame}>
          <Text style={styles.buttonText}>NEW GAME</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={props.onJoinGame}>
          <Text style={styles.buttonText}>JOIN GAME</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={props.onSettings}>
          <Text style={styles.buttonText}>SETTINGS</Text>
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
    fontSize: 48,
    color: colors.gold,
    marginBottom: 40,
  },
  buttons: {
    width: '100%',
    maxWidth: 280,
    gap: 12,
    marginBottom: 24,
  },
  button: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  resumeButton: {
    borderWidth: 1,
    borderColor: colors.gold,
  },
  buttonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
});
