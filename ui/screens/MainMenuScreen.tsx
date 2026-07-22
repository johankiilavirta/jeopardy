import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

const SCREEN_TOP_PADDING = 64;
const SCREEN_SIDE_PADDING = 32;
const TITLE_TO_CONTENT_GAP = 40;

interface MainMenuScreenProps {
  onNewGame: () => void;
  onJoinGame: () => void;
  onSettings: () => void;
  onHistory?: (() => void) | undefined;
  /** Present when an unfinished game snapshot is saved on this device. */
  onResumeGame?: (() => void) | undefined;
}

export function MainMenuScreen(props: MainMenuScreenProps) {
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Text style={styles.title}>JEOPARDY</Text>
        <View style={styles.buttons}>
          {props.onResumeGame && (
            <Pressable
              style={({ pressed }) => [styles.button, styles.resumeButton, pressed && styles.buttonPressed]}
              onPress={props.onResumeGame}
            >
              <Text style={styles.buttonText}>RESUME GAME</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={props.onNewGame}
          >
            <Text style={styles.buttonText}>NEW GAME</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={props.onJoinGame}
          >
            <Text style={styles.buttonText}>JOIN GAME</Text>
          </Pressable>
          {props.onHistory && (
            <Pressable
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              onPress={props.onHistory}
            >
              <Text style={styles.buttonText}>MATCH HISTORY</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={props.onSettings}
          >
            <Text style={styles.buttonText}>SETTINGS</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SCREEN_SIDE_PADDING,
    paddingTop: SCREEN_TOP_PADDING,
    paddingBottom: SCREEN_SIDE_PADDING,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 48,
    color: colors.gold,
    marginBottom: TITLE_TO_CONTENT_GAP,
  },
  buttons: {
    width: '100%',
    maxWidth: 280,
    gap: 12,
  },
  button: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonPressed: {
    backgroundColor: colors.activeOutline,
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
