import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Player } from '../../src/types';
import { colors, type as typeTokens } from '../theme/tokens';
import { PLAYER_BLOCK_HEIGHT, sortLocalFirst } from './PlayerHeader';

/** Extra headroom above the tab so the spring's overshoot isn't clipped. */
const OVERSHOOT_ROOM = 12;

interface JudgementTrayProps {
  players: Player[];
  /** Local player shown first — must match the score bar's ordering. */
  localPlayerId?: string | undefined;
  /** The player whose answer is on the stand. */
  judgedPlayerId: string;
  answer: string;
  onJudge: (correct: boolean, penalty?: boolean) => void;
  hasMoreToJudge: boolean;
}

/**
 * The judging control: a recessed tab that slides up from behind the judged
 * player's score bug — same height as the bug, a step darker than cell blue,
 * rounded top corners, no borders. Sitting on the player's own bug is the
 * attribution; either player can tap ✕, ✓, or the gray horizontal line (no penalty).
 * Correct answers immediately commit; incorrect/skip answers slide down and then
 * commit if there are more players to judge.
 *
 * Mount keyed by the judged player's id so a second buzzer's answer arrives
 * with fresh state and replays the rise.
 */
export function JudgementTray({
  players,
  localPlayerId,
  judgedPlayerId,
  answer,
  onJudge,
  hasMoreToJudge,
}: JudgementTrayProps) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(180), // wait for keyboard to fully slide down
      Animated.spring(rise, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [rise]);

  const choose = (correct: boolean, penalty: boolean = true) => {
    if (correct) {
      onJudge(true);
    } else {
      if (hasMoreToJudge) {
        // Slide down quickly and then transition to the next player
        Animated.timing(rise, {
          toValue: 0,
          duration: 120,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) onJudge(false, penalty);
        });
      } else {
        // No more players to judge: transition immediately without slide animation
        onJudge(false, penalty);
      }
    }
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  // Arrow keys judge too (right = correct, left = incorrect, down = pass/no penalty).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') chooseRef.current(true);
      if (e.key === 'ArrowLeft') chooseRef.current(false, true);
      if (e.key === 'ArrowDown') chooseRef.current(false, false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const judgedName = players.find(p => p.id === judgedPlayerId)?.name ?? 'Player';

  return (
    <View style={styles.row} pointerEvents="box-none">
      {sortLocalFirst(players, localPlayerId).map(player =>
        player.id === judgedPlayerId ? (
          // The clip window's bottom edge sits exactly on the bug's top edge,
          // so the tab rises out from "behind" the bug instead of over it.
          <View key={player.id} style={styles.clip} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.tab,
                {
                  transform: [
                    {
                      translateY: rise.interpolate({
                        inputRange: [0, 1],
                        outputRange: [PLAYER_BLOCK_HEIGHT + OVERSHOOT_ROOM, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text
                style={[styles.answerText, !answer && styles.answerEmpty]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
                allowFontScaling={false}
              >
                {answer || 'NO ANSWER'}
              </Text>
              <JudgeButton
                type="pass"
                label={`Skip ${judgedName}'s answer (no penalty)`}
                onPress={() => choose(false, false)}
              />
              <JudgeButton
                type="incorrect"
                label={`Mark ${judgedName}'s answer incorrect`}
                onPress={() => choose(false, true)}
              />
              <JudgeButton
                type="correct"
                label={`Mark ${judgedName}'s answer correct`}
                onPress={() => choose(true)}
              />
            </Animated.View>
          </View>
        ) : (
          // Empty slot keeping the tab aligned with this player's bug below.
          <View key={player.id} style={styles.slot} pointerEvents="none" />
        ),
      )}
    </View>
  );
}

function JudgeButton({
  type,
  label,
  onPress,
}: {
  type: 'correct' | 'incorrect' | 'pass';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>
        {type === 'correct' && (
          <>
            <View style={[styles.stroke, styles.strokeCorrect, styles.checkShort]} />
            <View style={[styles.stroke, styles.strokeCorrect, styles.checkLong]} />
            <View style={[styles.stroke, styles.strokeCorrect, styles.checkJoint]} />
          </>
        )}
        {type === 'incorrect' && (
          <>
            <View
              style={[styles.stroke, styles.strokeIncorrect, styles.cross, { transform: [{ rotate: '45deg' }] }]}
            />
            <View
              style={[styles.stroke, styles.strokeIncorrect, styles.cross, { transform: [{ rotate: '-45deg' }] }]}
            />
          </>
        )}
        {type === 'pass' && (
          <View style={[styles.stroke, styles.strokePass, styles.passLine]} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Mirrors PlayerHeader's row inside the screen's 3% horizontal inset, so
  // each slot sits exactly over that player's score bug — flush against its
  // top edge (8 = the screen's bottom padding).
  row: {
    position: 'absolute',
    left: '2%',
    right: '2%',
    bottom: 8 + PLAYER_BLOCK_HEIGHT,
    height: PLAYER_BLOCK_HEIGHT + OVERSHOOT_ROOM,
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    flex: 1,
  },
  clip: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  // A layer from behind the bug: a step darker than cell blue, slightly
  // inset, top corners rounded, no borders.
  tab: {
    height: PLAYER_BLOCK_HEIGHT,
    marginHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cellRecessed,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    paddingLeft: 18,
    paddingRight: 6,
  },
  answerText: {
    flex: 1,
    fontFamily: typeTokens.board,
    fontSize: 21,
    color: colors.categoryText,
    textAlign: 'center',
    transform: [{ scaleX: 0.85 }],
  },
  answerEmpty: {
    opacity: 0.45,
  },
  button: {
    width: 44,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  glyph: {
    width: 24,
    height: 24,
    overflow: 'visible',
  },
  stroke: {
    position: 'absolute',
    height: 3.5,
    borderRadius: 2,
  },
  // Brighter than the verdict fills so the small marks stay legible on the
  // dark tab.
  strokeIncorrect: {
    backgroundColor: '#E25550',
  },
  strokeCorrect: {
    backgroundColor: '#2EB865',
  },
  strokePass: {
    backgroundColor: '#8E8E93',
  },
  cross: {
    width: 24,
    left: 0,
    top: 10.25,
  },
  checkShort: {
    width: 10,
    left: 1,
    top: 13.75,
    transform: [{ rotate: '45deg' }],
  },
  checkLong: {
    width: 18.5,
    left: 6.25,
    top: 10.75,
    transform: [{ rotate: '-45deg' }],
  },
  checkJoint: {
    width: 3.5,
    height: 3.5,
    borderRadius: 1.75,
    left: 7.5,
    top: 17.25,
  },
  passLine: {
    width: 16,
    left: 4,
    top: 10.25,
  },
});
