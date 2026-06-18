import { StyleSheet, View } from 'react-native';
import type { Player } from '../../src/types';
import { PlayerScoreBlock } from './PlayerScoreBlock';

interface PlayerHeaderProps {
  players: Player[];
  /** Id of the player whose turn it is (null = nobody highlighted). */
  currentTurnPlayerId: string | null;
  /** Local player shown first so each device's owner is top-left. */
  localPlayerId?: string | undefined;
  /** Id of a player who has disconnected. */
  disconnectedPlayerId?: string | null | undefined;
}

export function PlayerHeader({ players, currentTurnPlayerId, localPlayerId, disconnectedPlayerId }: PlayerHeaderProps) {
  const sorted = localPlayerId
    ? [...players].sort((a, b) =>
        a.id === localPlayerId ? -1 : b.id === localPlayerId ? 1 : 0,
      )
    : players;

  return (
    <View style={styles.row}>
      {sorted.map(player => (
        <PlayerScoreBlock
          key={player.id}
          name={player.name}
          score={player.score}
          activeTurn={player.id === currentTurnPlayerId}
          disconnected={player.id === disconnectedPlayerId}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
  },
});
