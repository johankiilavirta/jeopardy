import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { MatchResult } from '../../app/matchHistory';
import { ScoreChart } from '../components/ScoreChart';
import { colors, type as typeTokens } from '../theme/tokens';

interface MatchHistoryScreenProps {
  matches: MatchResult[];
  playerName: string;
  onBack: () => void;
}

const PLAYER_COLORS = ['#5B8DEF', '#E8A035'];

function resultForMatch(match: MatchResult, playerName: string): 'W' | 'L' | 'T' | null {
  const player = match.players.find(p => p.name === playerName);
  if (!player) return null;
  if (match.winnerNames.length > 1) return 'T';
  return match.winnerNames[0] === playerName ? 'W' : 'L';
}

function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function MatchHistoryScreen({ matches, playerName, onBack }: MatchHistoryScreenProps) {
  const [selectedMatch, setSelectedMatch] = useState<MatchResult | null>(null);
  const { width, height } = useWindowDimensions();

  if (selectedMatch) {
    const sorted = [...selectedMatch.players].sort((a, b) => b.score - a.score);
    const totalFirstBuzzes = sorted.reduce((sum, p) => sum + (p.firstBuzzCount ?? 0), 0);
    const chartWidth = Math.min(width - 48, 400);
    return (
      <View style={styles.root}>
        <Pressable style={styles.backButton} onPress={() => setSelectedMatch(null)}>
          <Text style={styles.backText}>← HISTORY</Text>
        </Pressable>
        <ScrollView contentContainerStyle={[styles.detailContent, { minHeight: height }]} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>GAME OVER</Text>
          <Text style={styles.date}>{dateLabel(selectedMatch.finishedAt)}</Text>
          {selectedMatch.gameNumber != null && <Text style={styles.date}>Game #{selectedMatch.gameNumber}</Text>}
          {sorted.map((player, index) => {
            const total = player.correct + player.incorrect;
            const correctness = total ? Math.round((player.correct / total) * 100) : 0;
            const buzzCount = player.buzzCount ?? 0;
            const firstBuzzPct = totalFirstBuzzes ? Math.round(((player.firstBuzzCount ?? 0) / totalFirstBuzzes) * 100) : 0;
            const averageReaction = buzzCount ? Math.round((player.reactionMsTotal ?? 0) / buzzCount) : null;
            return (
              <View key={`${player.name}-${index}`} style={styles.playerRow}>
                <View style={styles.nameRow}>
                  <View style={[styles.dot, { backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length] }]} />
                  <Text style={styles.score}>{player.name}: ${player.score.toLocaleString()}</Text>
                </View>
                <Text style={styles.stats}>{player.correct} correct · {player.incorrect} incorrect · {correctness}% correctness</Text>
                {buzzCount > 0 && <Text style={styles.stats}>{firstBuzzPct}% buzzed first · {averageReaction}ms average reaction</Text>}
                {player.finalWager != null && <Text style={styles.stats}>${player.finalWager.toLocaleString()} final wager</Text>}
              </View>
            );
          })}
          <ScoreChart
            players={sorted.map((player, index) => ({
              name: player.name,
              color: PLAYER_COLORS[index % PLAYER_COLORS.length]!,
              scores: player.scoreHistory ?? [player.score],
            }))}
            width={chartWidth}
            height={160}
          />
        </ScrollView>
      </View>
    );
  }

  const results = matches.reduce((totals, match) => {
    const result = resultForMatch(match, playerName);
    if (result === 'W') totals.wins++;
    if (result === 'L') totals.losses++;
    if (result === 'T') totals.ties++;
    return totals;
  }, { wins: 0, losses: 0, ties: 0 });

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← SETTINGS</Text>
      </Pressable>
      <ScrollView contentContainerStyle={[styles.listContent, { minHeight: height }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>HISTORY</Text>
        {playerName ? <Text style={styles.record}>{results.wins}W · {results.losses}L{results.ties ? ` · ${results.ties}T` : ''}</Text> : <Text style={styles.record}>Set your player name to track W/L</Text>}
        {matches.length === 0 ? (
          <Text style={styles.empty}>No finished games yet.</Text>
        ) : matches.map(match => {
          const result = resultForMatch(match, playerName);
          const winner = match.winnerNames.length === 1 ? `${match.winnerNames[0]} won` : 'Tie game';
          return (
            <Pressable key={match.id} style={({ pressed }) => [styles.match, pressed && styles.matchPressed]} onPress={() => setSelectedMatch(match)}>
              <View style={styles.matchTop}>
                <Text style={styles.matchDate}>{dateLabel(match.finishedAt)}</Text>
                {result && <Text style={[styles.result, result === 'W' ? styles.win : result === 'L' ? styles.loss : styles.tie]}>{result}</Text>}
              </View>
              <Text style={styles.winner}>{winner}</Text>
              <Text style={styles.players} numberOfLines={1}>{match.players.map(p => `${p.name} $${p.score.toLocaleString()}`).join('  ·  ')}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backButton: { position: 'absolute', top: 16, left: 16, padding: 8, zIndex: 1 },
  backText: { fontFamily: typeTokens.ui500, fontSize: 16, color: colors.gold },
  listContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 64, paddingBottom: 32 },
  detailContent: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 64, paddingBottom: 32 },
  title: { fontFamily: typeTokens.board, fontSize: 36, color: colors.gold },
  record: { marginTop: 8, marginBottom: 28, fontFamily: typeTokens.ui700, fontSize: 18, color: '#fff' },
  empty: { marginTop: 36, fontFamily: typeTokens.ui500, fontSize: 17, color: 'rgba(255,255,255,0.55)' },
  match: { width: '100%', maxWidth: 440, backgroundColor: colors.cell, borderRadius: 6, padding: 16, marginBottom: 10 },
  matchPressed: { backgroundColor: colors.activeOutline },
  matchTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  matchDate: { fontFamily: typeTokens.ui700, fontSize: 17, color: colors.gold },
  result: { fontFamily: typeTokens.ui700, fontSize: 18 },
  win: { color: '#6FE08B' }, loss: { color: '#F07B7B' }, tie: { color: '#D7D7D7' },
  winner: { marginTop: 4, fontFamily: typeTokens.ui500, fontSize: 15, color: '#fff' },
  players: { marginTop: 4, fontFamily: typeTokens.ui500, fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  date: { marginTop: 4, fontFamily: typeTokens.ui500, fontSize: 14, color: 'rgba(255,255,255,0.55)' },
  playerRow: { width: '100%', maxWidth: 400, marginTop: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  score: { fontFamily: typeTokens.ui700, fontSize: 20, color: '#fff' },
  stats: { marginTop: 3, fontFamily: typeTokens.ui500, fontSize: 14, color: 'rgba(255,255,255,0.65)' },
});
