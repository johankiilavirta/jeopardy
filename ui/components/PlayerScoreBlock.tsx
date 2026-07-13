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
  
  // Animation drivers
  const animVal = useRef(new Animated.Value(0)).current;        // diff tag continuous timeline (0 -> 1)
  const scoreScaleVal = useRef(new Animated.Value(1)).current;  // main score text scale pulse
  const borderFlashVal = useRef(new Animated.Value(0)).current; // block border glow overlay
  
  const prevScoreRef = useRef(score);

  useEffect(() => {
    const prevScore = prevScoreRef.current;
    if (score !== prevScore) {
      prevScoreRef.current = score;
      const diff = score - prevScore;
      setAnimDiff(diff);
      
      // Reset drivers
      animVal.setValue(0);
      scoreScaleVal.setValue(1);
      borderFlashVal.setValue(0);

      // 1. Tag continuous float-up and fade-out timeline
      Animated.timing(animVal, {
        toValue: 1,
        duration: 1100, // 1.1s continuous motion
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setAnimDiff(null);
        }
      });

      // 2. Block colored flash overlay
      Animated.timing(borderFlashVal, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();

      // 3. Delayed score value change + text scale pulse
      const timer = setTimeout(() => {
        setDisplayedScore(score);
        
        Animated.sequence([
          Animated.timing(scoreScaleVal, {
            toValue: 1.25,
            duration: 100,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(scoreScaleVal, {
            toValue: 1,
            friction: 5,
            tension: 100,
            useNativeDriver: true,
          }),
        ]).start();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [score, animVal, scoreScaleVal, borderFlashVal]);

  const diffOpacity = animVal.interpolate({
    inputRange: [0, 0.1, 0.75, 1],
    outputRange: [0, 1, 1, 0],
    extrapolate: 'clamp',
  });

  const diffScale = animVal.interpolate({
    inputRange: [0, 0.12, 0.22, 0.75, 1],
    outputRange: [0.5, 1.15, 1, 1, 0.8],
    extrapolate: 'clamp',
  });

  const diffTranslateY = animVal.interpolate({
    inputRange: [0, 0.12, 0.75, 1],
    outputRange: [8, 0, -8, -26],
  });

  const diffTranslateX = animVal.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [0, 2, 8],
  });

  const diffRotate = animVal.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: ['0deg', animDiff && animDiff > 0 ? '-4deg' : '4deg', animDiff && animDiff > 0 ? '-6deg' : '6deg'],
  });

  const flashOpacity = borderFlashVal.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.45, 0],
  });

  return (
    <View style={[styles.block, activeTurn && styles.blockActive, disconnected && styles.blockDisconnected]}>
      {/* Background colored flash overlay */}
      {animDiff !== null && (
        <Animated.View
          style={[
            styles.flashOverlay,
            {
              opacity: flashOpacity,
              backgroundColor: animDiff > 0 ? '#2EB865' : '#E25550',
            },
          ]}
          pointerEvents="none"
        />
      )}

      <Text style={styles.name} numberOfLines={1} allowFontScaling={false}>
        {name.toUpperCase()}
      </Text>
      
      <View style={styles.scoreContainer}>
        <Animated.Text
          style={[
            styles.score,
            displayedScore < 0 && styles.scoreNegative,
            { transform: [{ scale: scoreScaleVal }] },
          ]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {formatScore(displayedScore)}
        </Animated.Text>
        
        {animDiff !== null && (
          <Animated.Text
            style={[
              styles.floatingDiff,
              animDiff > 0 ? styles.floatingDiffPositive : styles.floatingDiffNegative,
              {
                opacity: diffOpacity,
                transform: [
                  { translateY: diffTranslateY },
                  { translateX: diffTranslateX },
                  { scale: diffScale },
                  { rotate: diffRotate },
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
    position: 'relative',
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
    overflow: 'visible', // allows the floating tag to pop out of bounds
  },
  flashOverlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius - 1,
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
    overflow: 'visible',
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
    top: -6,
    right: -34,
    fontSize: 12,
    fontFamily: typeTokens.ui700,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  floatingDiffPositive: {
    color: '#2EB865',
  },
  floatingDiffNegative: {
    color: '#E25550',
  },
});
