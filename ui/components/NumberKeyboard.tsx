import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

const NUMBER_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];
const BACKSPACE = '⌫';
const KEY_RADIUS = 8;

interface NumberKeyboardProps {
  onInsert: (char: string) => void;
  onBackspace: () => void;
  onMaxWager?: () => void;
  /** Final Jeopardy: the keys swap cell navy for the round's charcoal. */
  final?: boolean;
  /** Use the neutral charcoal keys outside of the blue game board. */
  dark?: boolean;
}

function Key({
  label,
  flex = 1,
  final = false,
  onPress,
}: {
  label: string;
  flex?: number;
  final?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.key, final && styles.keyFinal, { flex }, pressed && styles.keyPressed]}
      onPress={onPress}
    >
      <Text style={styles.keyText} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

export const NumberKeyboard = memo(function NumberKeyboard({ onInsert, onBackspace, onMaxWager, final = false, dark = false }: NumberKeyboardProps) {
  return (
    <View style={styles.keyboard}>
      {NUMBER_ROWS.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map(ch => (
            <Key key={ch} label={ch} final={final || dark} onPress={() => onInsert(ch)} />
          ))}
        </View>
      ))}
      <View style={styles.row}>
        {onMaxWager ? (
          <Key label="MAX" final={final || dark} onPress={onMaxWager} />
        ) : (
          <View style={styles.spacer} />
        )}
        <Key label="0" final={final || dark} onPress={() => onInsert('0')} />
        <Key label={BACKSPACE} final={final || dark} onPress={onBackspace} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
  spacer: {
    flex: 1,
  },
  key: {
    backgroundColor: colors.cell,
    borderRadius: KEY_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyFinal: {
    backgroundColor: colors.cellFinal,
  },
  keyPressed: {
    backgroundColor: colors.activeOutline,
  },
  keyText: {
    fontFamily: typeTokens.ui500,
    fontSize: 20,
    color: '#FFFFFF',
  },
});
