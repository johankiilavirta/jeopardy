import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, type as typeTokens } from '../theme/tokens';

/**
 * Deliberately simple in-app keyboard so we never summon the iOS system
 * keyboard: uppercase letters, apostrophe, hyphen, space and backspace.
 * No shift, no autocorrect, no nonsense. Designed to sit on a dark
 * BlurView (frosted glass) — the keys are faint frost chips.
 */

const LETTER_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const BACKSPACE = '\u232b';

interface AnswerKeyboardProps {
  onInsert: (char: string) => void;
  onBackspace: () => void;
}

function Key({
  label,
  flex = 1,
  onPress,
}: {
  label: string;
  flex?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.key, { flex }, pressed && styles.keyPressed]}
      onPress={onPress}
    >
      <Text style={styles.keyText} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AnswerKeyboard({ onInsert, onBackspace }: AnswerKeyboardProps) {
  return (
    <View style={styles.keyboard}>
      {LETTER_ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map(ch => (
            <Key key={ch} label={ch} onPress={() => onInsert(ch)} />
          ))}
          {i === LETTER_ROWS.length - 1 && (
            <Key label={BACKSPACE} flex={2} onPress={onBackspace} />
          )}
        </View>
      ))}
      <View style={styles.row}>
        <Key label={'\u2019'} onPress={() => onInsert('\u2019')} />
        <Key label="SPACE" flex={5} onPress={() => onInsert(' ')} />
        <Key label="-" onPress={() => onInsert('-')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    gap: 5,
  },
  row: {
    flexDirection: 'row',
    gap: 5,
  },
  key: {
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  keyText: {
    fontFamily: typeTokens.ui500,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
