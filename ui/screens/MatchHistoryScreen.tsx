import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { isOngoingMatch, type MatchResult } from '../../app/matchHistory';
import { Board } from '../components/Board';
import type { BoardDefinition } from '../fixtures/board';
import { ScoreChart } from '../components/ScoreChart';
import { colors, grid, type as typeTokens } from '../theme/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface MatchHistoryScreenProps {
  matches: MatchResult[];
  playerName: string;
  onBack: () => void;
  onResumeMatch: (match: MatchResult) => void;
}

const PLAYER_COLORS = ['#5B8DEF', '#E8A035'];
const MAX_VISIBLE_MATCHES = 15;
const EXIT_DISTANCE = 100;
const EXIT_VELOCITY = 0.5;

function resultForMatch(match: MatchResult, playerName: string): 'W' | 'L' | 'T' | null {
  if (isOngoingMatch(match)) return null;
  const normalizedPlayerName = playerName.trim().toLowerCase();
  const player = match.players.find(p => p.name.trim().toLowerCase() === normalizedPlayerName);
  if (!player) return null;
  if (match.winnerNames.length > 1) return 'T';
  if (!match.winnerNames[0]) return null;
  return match.winnerNames[0].trim().toLowerCase() === normalizedPlayerName ? 'W' : 'L';
}

function compactScore(score: number, roundUp = false): string {
  const absolute = Math.abs(Math.round(score));
  if (absolute < 1000) return `${score < 0 ? '-' : ''}${absolute}`;
  if (score < 0) return `-${(absolute / 1000).toFixed(1).replace('.0', '')}k`;
  const thousands = Math.floor(absolute / 1000);
  const rounded = roundUp || absolute % 1000 >= 900 ? thousands + 1 : thousands;
  return `${score < 0 ? '-' : ''}${rounded}k`;
}

function deltaAmount(amount: number): string {
  const absolute = Math.abs(Math.round(amount));
  if (absolute < 1000) return `$${absolute}`;
  return `$${(absolute / 1000).toFixed(1).replace('.0', '')}k`;
}

function scoreBug(match: MatchResult, result: 'W' | 'L' | 'T' | null, playerName: string): string {
  const players = [...match.players].sort((a, b) => a.name.localeCompare(b.name));
  if (players.length < 2) return players[0] ? compactScore(players[0].score) : '';
  const normalizedPlayerName = playerName.trim().toLowerCase();
  const localPlayer = players.find(player => player.name.trim().toLowerCase() === normalizedPlayerName);
  const opponent = localPlayer && players.find(player => player !== localPlayer);
  if (localPlayer && opponent && (result === 'W' || result === 'L')) {
    const difference = Math.abs(localPlayer.score - opponent.score);
    return `${result === 'W' ? '+' : '-'}${deltaAmount(difference)}`;
  }
  const first = players[0]!;
  const second = players[1]!;
  const scoreDifference = Math.abs(first.score - second.score);
  let firstScore: string;
  let secondScore: string;
  const useCloseScorePrecision = scoreDifference > 0 && scoreDifference <= 1500 &&
    Math.max(Math.abs(first.score), Math.abs(second.score)) >= 1000;
  if (useCloseScorePrecision) {
    firstScore = `${(first.score / 1000).toFixed(1).replace('.0', '')}k`;
    secondScore = `${(second.score / 1000).toFixed(1).replace('.0', '')}k`;
  } else {
    const firstNeedsBump = result !== 'T' && result !== null &&
      Math.floor(Math.abs(first.score) / 1000) === Math.floor(Math.abs(second.score) / 1000) &&
      ((result === 'W' && first.name.trim().toLowerCase() === playerName.trim().toLowerCase()) ||
        (result === 'L' && first.name.trim().toLowerCase() !== playerName.trim().toLowerCase()));
    const secondNeedsBump = result !== 'T' && result !== null &&
      Math.floor(Math.abs(first.score) / 1000) === Math.floor(Math.abs(second.score) / 1000) &&
      ((result === 'W' && second.name.trim().toLowerCase() === playerName.trim().toLowerCase()) ||
        (result === 'L' && second.name.trim().toLowerCase() !== playerName.trim().toLowerCase()));
    firstScore = compactScore(first.score, firstNeedsBump);
    secondScore = compactScore(second.score, secondNeedsBump);
  }
  return `$${firstScore} vs $${secondScore}`;
}

function dateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function distributeDateGames(games: MatchResult[]): MatchResult[][] {
  const capped = games.slice(0, 9);
  if (capped.length <= 4) return [capped];
  if (capped.length === 5) return [capped.slice(0, 3), capped.slice(3)];
  const columnCount = Math.ceil(capped.length / 3);
  const base = Math.floor(capped.length / columnCount);
  const remainder = capped.length % columnCount;
  const columns: MatchResult[][] = [];
  let offset = 0;
  for (let column = 0; column < columnCount; column++) {
    const size = base + (column >= columnCount - remainder ? 1 : 0);
    columns.push(capped.slice(offset, offset + size));
    offset += size;
  }
  return columns;
}

function playerLabel(match: MatchResult, playerName: string): string {
  const names = match.players.map(player => player.name).sort((a, b) => a.localeCompare(b));
  const localIndex = names.findIndex(name => name.trim().toLowerCase() === playerName.trim().toLowerCase());
  if (localIndex >= 0 && names.length > 1) {
    const opponent = names[localIndex === 0 ? 1 : 0];
    return opponent ? `vs ${opponent.toUpperCase()}` : '';
  }
  return names.map(name => name.toUpperCase()).join(' vs ');
}

function canOpenMatch(match: MatchResult): boolean {
  return Array.isArray(match.players) && match.players.length > 0 &&
    match.players.every(player =>
      typeof player.name === 'string' &&
      Number.isFinite(player.score) &&
      Number.isFinite(player.correct) &&
      Number.isFinite(player.incorrect) &&
      (player.scoreHistory == null || (Array.isArray(player.scoreHistory) && player.scoreHistory.every(Number.isFinite))),
    ) && Array.isArray(match.winnerNames);
}

function Chevron({ flipped = false }: { flipped?: boolean }) {
  return (
    <View style={[styles.chevron, flipped && styles.chevronFlipped]}>
      <View style={[styles.chevronStroke, styles.chevronTop]} />
      <View style={[styles.chevronStroke, styles.chevronBottom]} />
    </View>
  );
}

export function MatchHistoryScreen({ matches, playerName, onBack, onResumeMatch }: MatchHistoryScreenProps) {
  const [selectedMatch, setSelectedMatch] = useState<MatchResult | null>(null);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pageX = useRef(new Animated.Value(0)).current;
  const chevronVisible = useRef(new Animated.Value(1)).current;
  const exitDragRef = useRef(0);
  const exitDirectionRef = useRef<-1 | 1 | null>(null);
  const visibleMatches = matches.slice(0, MAX_VISIBLE_MATCHES);
  const dateColumns = useMemo(() => {
    const dateGroups: { key: string; games: MatchResult[] }[] = [];
    for (const match of visibleMatches) {
      const timestamp = match.updatedAt ?? match.finishedAt;
      const key = dateKey(timestamp);
      const existing = dateGroups.find(group => group.key === key);
      if (existing) existing.games.push(match);
      else dateGroups.push({ key, games: [match] });
    }
    return dateGroups.flatMap(group => distributeDateGames(group.games)).slice(0, 5);
  }, [matches]);
  const historyBoard = useMemo<BoardDefinition>(() => ({
    categories: Array.from({ length: 5 }, (_, column) => {
      const games = dateColumns[column] ?? [];
      return {
      name: games[0] ? dateLabel(games[0].updatedAt ?? games[0].finishedAt) : '',
      clues: Array.from({ length: 5 }, (_, row) => ({ id: column * 5 + row, value: (row + 1) * 200 })),
      };
    }),
  }), [dateColumns]);
  const exitResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 15 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
    onPanResponderGrant: () => {
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
    },
    onPanResponderMove: (_event, gesture) => {
      if (exitDirectionRef.current == null && gesture.dx !== 0) exitDirectionRef.current = gesture.dx < 0 ? -1 : 1;
      const direction = exitDirectionRef.current ?? 1;
      const directedDx = direction < 0 ? Math.min(0, gesture.dx) : Math.max(0, gesture.dx);
      const distance = Math.abs(directedDx);
      const resisted = distance <= EXIT_DISTANCE ? distance : EXIT_DISTANCE + (distance - EXIT_DISTANCE) * 0.15;
      exitDragRef.current = resisted;
      pageX.setValue(direction * resisted);
    },
    onPanResponderRelease: (_event, gesture) => {
      const direction = exitDirectionRef.current;
      const velocityCommitted = direction === -1 ? gesture.vx <= -EXIT_VELOCITY : direction === 1 ? gesture.vx >= EXIT_VELOCITY : false;
      if (direction && (exitDragRef.current >= EXIT_DISTANCE || (exitDragRef.current >= 40 && velocityCommitted))) {
        chevronVisible.setValue(0);
        pageX.setValue(0);
        onBack();
        return;
      }
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
      Animated.spring(pageX, { toValue: 0, speed: 14, bounciness: 4, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => {
      exitDragRef.current = 0;
      exitDirectionRef.current = null;
      Animated.spring(pageX, { toValue: 0, speed: 14, bounciness: 4, useNativeDriver: true }).start();
    },
  }), [chevronVisible, onBack, pageX, width]);

  if (selectedMatch) {
    const sorted = [...selectedMatch.players].sort((a, b) => b.score - a.score);
    const totalFirstBuzzes = sorted.reduce((sum, p) => sum + (p.firstBuzzCount ?? 0), 0);
    return (
      <View style={[styles.root, { marginBottom: -insets.bottom }]} {...exitResponder.panHandlers}>
        <Pressable style={styles.backButton} onPress={() => setSelectedMatch(null)}>
          <Text style={styles.backText}>← BACK</Text>
        </Pressable>
        <View style={styles.detailContent}>
          <Text style={styles.detailTitle}>{isOngoingMatch(selectedMatch) ? 'ONGOING GAME' : 'GAME OVER'}</Text>
          {selectedMatch.gameNumber != null && <Text style={styles.detailDate}>GAME #{selectedMatch.gameNumber}</Text>}
          {sorted.map((player, index) => {
            const total = player.correct + player.incorrect;
            const correctness = total ? Math.round((player.correct / total) * 100) : 0;
            const buzzCount = player.buzzCount ?? 0;
            const firstBuzzPct = totalFirstBuzzes ? Math.round(((player.firstBuzzCount ?? 0) / totalFirstBuzzes) * 100) : 0;
            const averageReaction = buzzCount ? Math.round((player.reactionMsTotal ?? 0) / buzzCount) : null;
            return (
              <View key={`${player.name}-${index}`} style={styles.playerRow}>
                <Text style={styles.score}>{player.name}: ${player.score.toLocaleString()}</Text>
                <Text style={styles.stats}>{player.correct} correct · {player.incorrect} incorrect · {correctness}% correctness</Text>
                {buzzCount > 0 && <Text style={styles.stats}>{firstBuzzPct}% buzzed first · {averageReaction}ms average reaction</Text>}
              </View>
            );
          })}
          {isOngoingMatch(selectedMatch) && (
            <Pressable style={styles.resumeButton} onPress={() => onResumeMatch(selectedMatch)}>
              <Text style={styles.resumeText}>OPEN NEW LOBBY</Text>
            </Pressable>
          )}
          {!isOngoingMatch(selectedMatch) && (
            <ScoreChart
              players={sorted.map((player, index) => ({ name: player.name, color: PLAYER_COLORS[index % PLAYER_COLORS.length]!, scores: player.scoreHistory ?? [player.score] }))}
              width={Math.min(width - 48, 400)}
              height={140}
            />
          )}
        </View>
        <ExitChevrons pageX={pageX} visible={chevronVisible} />
      </View>
    );
  }

  const completedGames = matches.filter(match => !isOngoingMatch(match));
  const wins = completedGames.filter(match => resultForMatch(match, playerName) === 'W').length;
  const losses = completedGames.filter(match => resultForMatch(match, playerName) === 'L').length;
  const ties = completedGames.filter(match => resultForMatch(match, playerName) === 'T').length;
  const winRate = completedGames.length ? Math.round((wins / completedGames.length) * 100) : 0;
  const openMatch = (match: MatchResult) => {
    try {
      if (!canOpenMatch(match)) return;
      if (isOngoingMatch(match)) onResumeMatch(match);
      else setSelectedMatch(match);
    } catch {
      // Older history entries are local data; a bad record should be inert.
    }
  };
  const totalFlex = 6.25;
  const boardGap = grid.lineWidth;
  const contentHeight = Math.max(0, boardSize.height - boardGap * 5);
  const categoryHeight = contentHeight * 1.25 / totalFlex;
  const clueHeight = contentHeight / totalFlex;
  const columnCount = 5;
  const clueWidth = Math.max(0, (boardSize.width - boardGap * (columnCount - 1)) / columnCount);

  return (
    <View style={[styles.root, { marginBottom: -insets.bottom }]} {...exitResponder.panHandlers}>
      <Animated.View style={styles.page}>
        <View
          style={styles.boardHost}
          onLayout={event => {
            const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
            setBoardSize(current => current.width === nextWidth && current.height === nextHeight
              ? current : { width: nextWidth, height: nextHeight });
          }}
        >
          <Board board={historyBoard} burnedClueIds={Array.from({ length: columnCount * 5 }, (_, index) => index)} locked categoryMaxFontSize={24} />
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {dateColumns.flatMap((games, column) => games.map((match, row) => {
              const result = resultForMatch(match, playerName);
              const ongoing = isOngoingMatch(match);
              const resultLabel = scoreBug(match, result, playerName);
              return (
                <Pressable
                  key={match.id}
                  style={({ pressed }) => [styles.tile, pressed && styles.tilePressed, {
                    left: column * (clueWidth + boardGap),
                    top: categoryHeight + boardGap + row * (clueHeight + boardGap),
                    width: clueWidth,
                    height: clueHeight,
                  }]}
                  onPress={() => openMatch(match)}
                >
                  <Text style={styles.tileGame} numberOfLines={1}>{match.gameNumber != null ? `#${match.gameNumber}` : 'DEMO'}</Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.tileResult, ongoing ? styles.ongoing : result === 'W' ? styles.win : result === 'L' ? styles.loss : styles.tie]}>{resultLabel}</Text>
                  {ongoing && <Text style={styles.ongoingMark}>!</Text>}
                  <Text style={styles.tilePlayers} numberOfLines={1}>{playerLabel(match, playerName)}</Text>
                </Pressable>
              );
            }))}
          </View>
        </View>
          <LinearGradient pointerEvents="none" colors={[colors.backgroundTransparent, colors.background]} style={styles.statsGradient}>
          <View style={styles.statsRow}>
            <View style={styles.statColumn}>
              <View style={styles.statValueFrame}><Text style={styles.statValueRate}>{winRate}%</Text></View>
              <Text style={styles.statLabel}>WIN RATE</Text>
            </View>
            <View style={styles.statColumn}>
              <View style={styles.statValueFrame}><Text style={styles.statValueRecord}>{wins}W-{losses}L{ties ? `-${ties}T` : ''}</Text></View>
              <Text style={styles.statLabel}>RECORD</Text>
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
      <ExitChevrons pageX={pageX} visible={chevronVisible} />
    </View>
  );
}

function ExitChevrons({ pageX, visible }: { pageX: Animated.Value; visible: Animated.Value }) {
  const leftOpacity = pageX.interpolate({ inputRange: [0, 20, EXIT_DISTANCE], outputRange: [0, 0.4, 1], extrapolate: 'clamp' });
  const rightOpacity = pageX.interpolate({ inputRange: [-EXIT_DISTANCE, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });
  const leftTranslate = pageX.interpolate({ inputRange: [0, EXIT_DISTANCE], outputRange: [-68, 0], extrapolate: 'clamp' });
  const rightTranslate = pageX.interpolate({ inputRange: [-EXIT_DISTANCE, 0], outputRange: [0, 68], extrapolate: 'clamp' });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: visible }]}>
      <Animated.View style={[styles.exitIcon, styles.exitLeft, { opacity: leftOpacity, transform: [{ translateX: leftTranslate }] }]}><Chevron flipped /></Animated.View>
      <Animated.View style={[styles.exitIcon, styles.exitRight, { opacity: rightOpacity, transform: [{ translateX: rightTranslate }] }]}><Chevron /></Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  page: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  boardHost: { position: 'absolute', top: 0, right: 14, bottom: 0, left: 14, backgroundColor: colors.background },
  tile: { position: 'absolute', backgroundColor: colors.cell, padding: 7 },
  tilePressed: { backgroundColor: 'rgba(46,91,255,0.45)' },
  tileGame: { fontFamily: typeTokens.board, fontSize: 13, color: colors.boardValue },
  tileResult: { position: 'absolute', top: 7, left: 4, right: 4, textAlign: 'right', fontFamily: typeTokens.ui700, fontSize: 10 },
  tilePlayers: { position: 'absolute', left: 7, right: 7, bottom: 7, fontFamily: typeTokens.ui500, fontSize: 12, color: '#fff' },
  win: { color: '#6FE08B' }, loss: { color: '#F07B7B' }, tie: { color: '#D7D7D7' }, ongoing: { color: colors.gold },
  ongoingMark: { position: 'absolute', right: 7, bottom: 5, fontFamily: typeTokens.ui700, fontSize: 18, lineHeight: 19, color: '#F28C28' },
  statsGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '28%', justifyContent: 'flex-end', paddingBottom: 18 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statColumn: { flex: 1, alignItems: 'center' },
  statValueFrame: { height: 32, alignItems: 'center', justifyContent: 'center' },
  statValueRate: { fontFamily: typeTokens.board, fontSize: 22, lineHeight: 32, color: colors.gold },
  statValueRecord: { fontFamily: typeTokens.board, fontSize: 19, lineHeight: 32, color: colors.gold },
  statLabel: { marginTop: 1, fontFamily: typeTokens.ui700, fontSize: 11, letterSpacing: 1.6, color: '#fff' },
  backButton: { position: 'absolute', top: 16, left: 16, padding: 8, zIndex: 2 },
  backText: { fontFamily: typeTokens.ui500, fontSize: 16, color: colors.gold },
  detailContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  detailTitle: { fontFamily: typeTokens.board, fontSize: 36, color: colors.gold },
  detailDate: { marginTop: 6, fontFamily: typeTokens.ui500, fontSize: 14, color: 'rgba(255,255,255,0.55)' },
  playerRow: { width: '100%', maxWidth: 400, marginTop: 20 },
  score: { fontFamily: typeTokens.ui700, fontSize: 20, color: '#fff' },
  stats: { marginTop: 3, fontFamily: typeTokens.ui500, fontSize: 14, color: 'rgba(255,255,255,0.65)' },
  resumeButton: { marginTop: 28, backgroundColor: colors.gold, paddingHorizontal: 22, paddingVertical: 13 },
  resumeText: { fontFamily: typeTokens.ui700, fontSize: 16, color: colors.bg },
  exitIcon: { position: 'absolute', top: '45%', width: 48, height: 48, borderRadius: 24, backgroundColor: colors.cellRecessed, alignItems: 'center', justifyContent: 'center' },
  exitLeft: { left: 8 }, exitRight: { right: 8 },
  chevron: { width: 24, height: 24 }, chevronFlipped: { transform: [{ scaleX: -1 }] },
  chevronStroke: { position: 'absolute', left: 4, width: 14, height: 3.5, borderRadius: 2, backgroundColor: '#FFFFFF' },
  chevronTop: { top: 5.25, transform: [{ rotate: '-45deg' }] }, chevronBottom: { top: 15.25, transform: [{ rotate: '45deg' }] },
});
