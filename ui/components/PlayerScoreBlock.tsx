import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
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
  const [displayedScore, setDisplayedScore] = useState(score);
  const [animDiff, setAnimDiff] = useState<number | null>(null);
  const animVal = useRef(new Animated.Value(0)).current;
  const prevScoreRef = useRef(score);

  useEffect(() => {
    const prevScore = prevScoreRef.current;
    if (score !== prevScore) {
      prevScoreRef.current = score;
      const diff = score - prevScore;
      setAnimDiff(diff);
      animVal.setValue(0);

      // Spring up, hold, then fade & float out
      Animated.sequence([
        Animated.spring(animVal, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.delay(450),
        Animated.timing(animVal, {
          toValue: 2,
          duration: 300,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setAnimDiff(null);
        }
      });

      // Update the main displayed score text after a brief beat (150ms)
      const timer = setTimeout(() => {
        setDisplayedScore(score);
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [score, animVal]);

  const diffOpacity = animVal.interpolate({
    inputRange: [0, 0.2, 1, 2],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  const diffScale = animVal.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
    extrapolate: 'clamp',
  });

  const diffTranslateY = animVal.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [4, 0, -12],
  });

  return (
    <View style={[styles.block, activeTurn && styles.blockActive, disconnected && styles.blockDisconnected]}>
      <Text style={styles.name} numberOfLines={1} allowFontScaling={false}>
        {name.toUpperCase()}
      </Text>
      <View style={styles.scoreContainer}>
        <Text
          style={[styles.score, displayedScore < 0 && styles.scoreNegative]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {formatScore(displayedScore)}
        </Text>
        {animDiff !== null && (
          <Animated.Text
            style={[
              styles.floatingDiff,
              animDiff > 0 ? styles.floatingDiffPositive : styles.floatingDiffNegative,
              {
                opacity: diffOpacity,
                transform: [
                  { translateY: diffTranslateY },
                  { scale: diffScale },
                ],
              },
            ]}
            allowFontScaling={false}
          >
            {animDiff > 0 ? `+$${animDiff}` : `-$${Math.abs(animDiff)}`}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.cell,
    borderRadius: radius,
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
  scoreContainer: {
    position: 'relative',
  },
  score: {
    fontFamily: typeTokens.ui700,
    fontSize: 17,
    color: colors.gold,
  },
  scoreNegative: {
    color: '#D9534F',
  },
  floatingDiff: {
    position: 'absolute',
    top: -14,
    left: -4,
    fontSize: 11,
    fontFamily: typeTokens.ui700,
  },
  floatingDiffPositive: {
    color: '#2EB865',
  },
  floatingDiffNegative: {
    color: '#E25550',
  },
});
