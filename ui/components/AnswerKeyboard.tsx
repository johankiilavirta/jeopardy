import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

/**
 * Deliberately simple in-app keyboard so we never summon the iOS system
 * keyboard: uppercase letters, space and backspace. No shift, no
 * autocorrect, no nonsense. Speaks the score widget's color language:
 * cell-blue key chips set into the sheet's recessed deck, flashing the
 * active-turn highlight blue when pressed. The space bar sits centered
 * on the bottom row.
 */

const LETTER_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const BACKSPACE = '⌫';

/** Softly rounded keys, echoing the sheet's rounded top corners. */
const KEY_RADIUS = 8;

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

/** Memoized: the keys are static, so with stable callbacks the whole deck
 *  skips re-rendering on every keystroke. */
export const AnswerKeyboard = memo(function AnswerKeyboard({ onInsert, onBackspace }: AnswerKeyboardProps) {
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
        <View style={styles.spacer} />
        <Key label="SPACE" flex={4} onPress={() => onInsert(' ')} />
        <View style={styles.spacer} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // The keyboard fills whatever height its host gives it: rows share the
  // space equally and never compress below a comfortable tap target.
  keyboard: {
    flex: 1,
    gap: 5,
  },
  row: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    gap: 5,
  },
  /** Symmetric gutters keeping the space bar at 40% of the deck width. */
  spacer: {
    flex: 3,
  },
  key: {
    backgroundColor: colors.cell,
    borderRadius: KEY_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: colors.activeOutline,
  },
  keyText: {
    fontFamily: typeTokens.ui500,
    fontSize: 17,
    color: '#FFFFFF',
  },
});
