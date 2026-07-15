import { useCallback, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { GameState } from '../../src/types';
import { Board } from '../components/Board';
import type { CellRect } from '../components/BoardCell';
import { PLAYER_BAR_HEIGHT, PLAYER_BLOCK_HEIGHT, PlayerHeader } from '../components/PlayerHeader';
import type { BoardDefinition } from '../fixtures/board';
import { CARD_BOTTOM_MARGIN, CARD_H_PAD } from './ClueScreen';
import { colors } from '../theme/tokens';

interface ChooseClueScreenProps {
  state: GameState;
  /** Which player this device belongs to. */
  localPlayerId: string;
  board: BoardDefinition;
  onSelectClue?: ((clueId: number, rect: CellRect) => void) | undefined;
  onSkipClue?: ((clueId: number) => void) | undefined;
  /** Id of a player who has disconnected. */
  disconnectedPlayerId?: string | null;
  /** Passed through to Board to trigger the DJ board-intro flash. */
  boardAnimKey?: number | undefined;
  /** Highlights the player whose answer is being judged. */
  judgingPlayerId?: string | null | undefined;
  animationsEnabled?: boolean;
}

export function ChooseClueScreen({
  state,
  localPlayerId,
  board,
  onSelectClue,
  onSkipClue,
  disconnectedPlayerId,
  boardAnimKey,
  judgingPlayerId,
  animationsEnabled = true,
}: ChooseClueScreenProps) {
  // null currentTurnPlayerId means anyone may pick the first clue.
  const locked =
    state.currentTurnPlayerId !== null && state.currentTurnPlayerId !== localPlayerId;

  // Remount the board whenever its measured size changes (rotation, initial
  // landscape launch): adjustsFontSizeToFit caches its fitted size and won't
  // recompute when the cell grows, leaving stale tiny/mid-reflow text. Using
  // onLayout (not useWindowDimensions) keys off the size the board actually
  // gets, which is correct even when window metrics are stale at launch.
  const [boardKey, setBoardKey] = useState<string | null>(null);
  const boardKeyRef = useRef<string | null>(null);

  // The board's fonts settle over several frames of onLayout measurements,
  // so the whole screen (board AND score bar) stays hidden until Board
  // reports ready, then fades in as one fully-formed unit. A size-change
  // remount (rotation) re-hides for a fresh reveal.
  const revealOpacity = useRef(new Animated.Value(0)).current;
  const revealedRef = useRef(false);
  const handleBoardReady = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    Animated.timing(revealOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [revealOpacity]);

  return (
    <Animated.View style={[styles.screen, { opacity: revealOpacity }]}>
      <View
        style={styles.boardWrap}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          const key = `${Math.round(width)}x${Math.round(height)}`;
          if (boardKeyRef.current !== null && boardKeyRef.current !== key) {
            revealedRef.current = false;
            revealOpacity.setValue(0);
          }
          boardKeyRef.current = key;
          setBoardKey(key);
        }}
      >
        {boardKey !== null && (
          <Board
            key={boardKey}
            board={board}
            burnedClueIds={state.burnedClueIds}
            locked={locked}
            onSelectClue={onSelectClue}
            onSkipClue={onSkipClue}
            boardAnimKey={boardAnimKey}
            onReady={handleBoardReady}
          />
        )}
      </View>
      <View style={styles.playerBarWrap}>
        <PlayerHeader
          players={Object.values(state.players)}
          currentTurnPlayerId={state.currentTurnPlayerId}
          localPlayerId={localPlayerId}
          disconnectedPlayerId={disconnectedPlayerId}
          judgingPlayerId={judgingPlayerId}
          animationsEnabled={animationsEnabled}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    // The board occupies exactly the clue card's footprint, so the card
    // expands over it edge-for-edge: same 5% side / 2% top insets, and
    // the gap below the board puts its bottom edge where the card's
    // bottom edge lands (bar inset + card bottom margin, minus the bar
    // itself).
    paddingTop: '2%',
    paddingBottom: 8,
    gap: PLAYER_BAR_HEIGHT + CARD_BOTTOM_MARGIN - (8 + PLAYER_BLOCK_HEIGHT),
  },
  boardWrap: {
    flex: 1,
    marginHorizontal: CARD_H_PAD,
  },
  // The score bugs sit on their own, wider 2% rails (the judgement tray
  // aligns to these), independent of the board/card inset.
  playerBarWrap: {
    paddingHorizontal: '2%',
  },
});
