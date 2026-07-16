import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Player } from '../../src/types';
import { colors, type as typeTokens } from '../theme/tokens';
import { PLAYER_BLOCK_HEIGHT, sortLocalFirst } from './PlayerHeader';

/** Extra headroom above the tab so the spring's overshoot isn't clipped. */
const OVERSHOOT_ROOM = 12;

/** One answer awaiting a verdict, aligned over its player's score bug. */
export interface JudgementStand {
  playerId: string;
  answer: string;
}

interface JudgementTrayProps {
  players: Player[];
  /** Local player shown first — must match the score bar's ordering. */
  localPlayerId?: string | undefined;
  /** The answers on the stand. Normal play has one; Final Jeopardy shows
   *  everyone's at once, judged in any order. */
  stands: JudgementStand[];
  onJudge: (playerId: string, correct: boolean, penalty?: boolean) => void;
  hasMoreToJudge: boolean;
  /** Final Jeopardy: the tab swaps its recessed navy for charcoal. */
  finalJeopardy?: boolean;
}

/**
 * The judging control: recessed tabs that slide up from behind the judged
 * players' score bugs — same height as the bug, a step darker than cell blue,
 * rounded top corners, no borders. Sitting on the player's own bug is the
 * attribution; either player can tap ✕, ✓, or the gray horizontal line (no
 * penalty). A verdict that leaves more judging to do slides its tab down
 * before committing; the last verdict commits immediately.
 *
 * Each tab is keyed by its player's id so a newly arriving answer replays
 * the rise with fresh state.
 */
export function JudgementTray({
  players,
  localPlayerId,
  stands,
  onJudge,
  hasMoreToJudge,
  finalJeopardy = false,
}: JudgementTrayProps) {
  // Arrow keys judge too, but only when exactly one answer is up
  // (right = correct, left = incorrect, down = pass/no penalty).
  const soleStand = stands.length === 1 ? stands[0] : undefined;
  const keyTarget = useRef<{ playerId: string; judge: JudgementTrayProps['onJudge'] } | null>(null);
  keyTarget.current = soleStand ? { playerId: soleStand.playerId, judge: onJudge } : null;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: KeyboardEvent) => {
      const target = keyTarget.current;
      if (!target) return;
      if (e.key === 'ArrowRight') target.judge(target.playerId, true);
      if (e.key === 'ArrowLeft') target.judge(target.playerId, false, true);
      if (e.key === 'ArrowDown') target.judge(target.playerId, false, false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <View style={styles.row} pointerEvents="box-none">
      {sortLocalFirst(players, localPlayerId).map(player => {
        const stand = stands.find(s => s.playerId === player.id);
        return stand ? (
          <JudgementTab
            key={player.id}
            playerName={player.name}
            stand={stand}
            // With several answers up, every verdict leaves more judging to
            // do, so all verdicts slide out; solo tabs keep the old behavior
            // (correct commits instantly, incorrect slides if others remain).
            slideOutCorrect={stands.length > 1}
            slideOutIncorrect={stands.length > 1 || hasMoreToJudge}
            onJudge={onJudge}
            finalJeopardy={finalJeopardy}
          />
        ) : (
          // Empty slot keeping the tabs aligned with this player's bug below.
          <View key={player.id} style={styles.slot} pointerEvents="none" />
        );
      })}
    </View>
  );
}

function JudgementTab({
  playerName,
  stand,
  slideOutCorrect,
  slideOutIncorrect,
  onJudge,
  finalJeopardy,
}: {
  playerName: string;
  stand: JudgementStand;
  slideOutCorrect: boolean;
  slideOutIncorrect: boolean;
  onJudge: (playerId: string, correct: boolean, penalty?: boolean) => void;
  finalJeopardy: boolean;
}) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(220), // wait for keyboard to fully slide down
      Animated.spring(rise, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [rise]);

  const choose = (correct: boolean, penalty: boolean = true) => {
    const slideOut = correct ? slideOutCorrect : slideOutIncorrect;
    if (slideOut) {
      // Slide down quickly, then commit the verdict.
      Animated.timing(rise, {
        toValue: 0,
        duration: 120,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onJudge(stand.playerId, correct, penalty);
      });
    } else {
      onJudge(stand.playerId, correct, penalty);
    }
  };

  return (
    // The clip window's bottom edge sits exactly on the bug's top edge,
    // so the tab rises out from "behind" the bug instead of over it.
    <View style={styles.clip} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.tab,
          finalJeopardy && styles.tabFinal,
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
          style={[styles.answerText, !stand.answer && styles.answerEmpty]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          allowFontScaling={false}
        >
          {stand.answer || 'NO ANSWER'}
        </Text>
        <JudgeButton
          type="pass"
          label={`Skip ${playerName}'s answer (no penalty)`}
          onPress={() => choose(false, false)}
        />
        <JudgeButton
          type="incorrect"
          label={`Mark ${playerName}'s answer incorrect`}
          onPress={() => choose(false, true)}
        />
        <JudgeButton
          type="correct"
          label={`Mark ${playerName}'s answer correct`}
          onPress={() => choose(true)}
        />
      </Animated.View>
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
  tabFinal: {
    backgroundColor: colors.cellFinalRecessed,
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
