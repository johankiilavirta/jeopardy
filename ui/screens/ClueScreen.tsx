import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ActiveClue } from '../../src/types';
import { colors, shadow, type as typeTokens } from '../theme/tokens';

interface ClueScreenProps {
  clue: ActiveClue;
  /** Demo wiring point: invoked when the card is tapped. */
  onContinue?: (() => void) | undefined;
}

export function ClueScreen({ clue, onContinue }: ClueScreenProps) {
  return (
    <Pressable style={styles.card} onPress={onContinue}>
      <View style={styles.header}>
        <Text style={styles.category} numberOfLines={1} allowFontScaling={false}>
          {clue.category.toUpperCase()}
        </Text>
        <Text style={styles.value} numberOfLines={1} allowFontScaling={false}>
          ${clue.value}
        </Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.clueText} allowFontScaling={false}>
          {clue.text.toUpperCase()}
        </Text>
      </View>

      <Text style={styles.hint} allowFontScaling={false}>
        TAP TO CONTINUE
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.cell,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 16,
  },
  category: {
    flexShrink: 1,
    fontFamily: typeTokens.board,
    fontSize: 20,
    color: colors.categoryText,
    transform: [{ scaleX: 0.85 }],
  },
  value: {
    fontFamily: typeTokens.board,
    fontSize: 20,
    color: colors.gold,
    transform: [{ scaleX: 0.85 }],
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  clueText: {
    fontFamily: typeTokens.ui500,
    fontSize: 26,
    lineHeight: 38,
    letterSpacing: 0.5,
    color: colors.categoryText,
    textAlign: 'center',
    textShadowColor: shadow.valueText.textShadowColor,
    textShadowOffset: shadow.valueText.textShadowOffset,
    textShadowRadius: shadow.valueText.textShadowRadius,
  },
  hint: {
    fontFamily: typeTokens.ui500,
    fontSize: 11,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
});
