import { StyleSheet, View } from 'react-native';
import type { Player } from '../../src/types';
import { PlayerScoreBlock } from './PlayerScoreBlock';

/** Space reserved at the bottom of an active-clue screen for the player bar. */
export const PLAYER_BAR_HEIGHT = 62;

/** Fixed height of the score blocks, so overlays (the judgement tray) can
 *  sit exactly flush against their top edge. */
export const PLAYER_BLOCK_HEIGHT = 44;

/** Local player first, so each device's owner is on the left. Shared with
 *  the judgement tray so it lines up with the same block ordering. */
export function sortLocalFirst(players: Player[], localPlayerId?: string): Player[] {
  return localPlayerId
    ? [...players].sort((a, b) =>
        a.id === localPlayerId ? -1 : b.id === localPlayerId ? 1 : 0,
      )
    : players;
}

interface PlayerHeaderProps {
  players: Player[];
  /** Id of the player whose turn it is (null = nobody highlighted). */
  currentTurnPlayerId: string | null;
  /** Local player shown first so each device's owner is top-left. */
  localPlayerId?: string | undefined;
  /** Id of a player who has disconnected. */
  disconnectedPlayerId?: string | null | undefined;
  /** The player whose answer is currently shown in the judgment tray. */
  judgingPlayerId?: string | null | undefined;
  /** Whether animations should play. */
  animationsEnabled?: boolean;
}

export function PlayerHeader({ players, currentTurnPlayerId, localPlayerId, disconnectedPlayerId, judgingPlayerId, animationsEnabled = true }: PlayerHeaderProps) {
  // While an answer is being judged, only the judged player is highlighted.
  const highlightId = judgingPlayerId ?? currentTurnPlayerId;

  return (
    <View style={styles.row}>
      {sortLocalFirst(players, localPlayerId).map(player => (
        <PlayerScoreBlock
          key={player.id}
          name={player.name}
          score={player.score}
          activeTurn={player.id === highlightId}
          disconnected={player.id === disconnectedPlayerId}
          animationsEnabled={animationsEnabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    width: '100%',
    height: PLAYER_BLOCK_HEIGHT,
    gap: 8,
  },
});
