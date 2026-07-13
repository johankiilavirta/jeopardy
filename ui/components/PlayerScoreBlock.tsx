import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type as typeTokens } from '../theme/tokens';

interface PlayerScoreBlockProps {
  name: string;
  score: number;
  /** Whether it is this player's turn to pick (renders the blue outline). */
  activeTurn: boolean;
  /** Whether this player has disconnected. */
  disconnected?: boolean;
}

function formatScore(score: number): string {
  const abs = Math.abs(score).toLocaleString('en-US');
  return score < 0 ? `-$${abs}` : `$${abs}`;
}

export function PlayerScoreBlock({ name, score, activeTurn, disconnected }: PlayerScoreBlockProps) {
  return (
    <View style={[styles.block, activeTurn && styles.blockActive, disconnected && styles.blockDisconnected]}>
      <Text style={styles.name} numberOfLines={1} allowFontScaling={false}>
        {name.toUpperCase()}
      </Text>
      <Text
        style={[styles.score, score < 0 && styles.scoreNegative]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {formatScore(score)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.cell,
    borderRadius: radius,
    // The active accent lives on the bottom edge only, so the top edge stays
    // clean for overlays (the judgement podium) to fuse onto the block.
    // Transparent when inactive so the accent causes no layout shift.
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  blockActive: {
    borderBottomColor: colors.activeOutline,
  },
  blockDisconnected: {
    opacity: 0.35,
  },
  name: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    letterSpacing: 1.5,
    color: colors.categoryText,
    opacity: 0.85,
  },
  score: {
    fontFamily: typeTokens.ui700,
    fontSize: 17,
    color: colors.gold,
  },
  scoreNegative: {
    color: '#D9534F',
  },
});
