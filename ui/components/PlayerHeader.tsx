import { StyleSheet, View } from 'react-native';
import type { Player } from '../../src/types';
import { PlayerScoreBlock } from './PlayerScoreBlock';

interface PlayerHeaderProps {
  players: Player[];
  /** Id of the player whose turn it is (null = nobody highlighted). */
  currentTurnPlayerId: string | null;
}

export function PlayerHeader({ players, currentTurnPlayerId }: PlayerHeaderProps) {
  return (
    <View style={styles.row}>
      {players.map(player => (
        <PlayerScoreBlock
          key={player.id}
          name={player.name}
          score={player.score}
          activeTurn={player.id === currentTurnPlayerId}
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
