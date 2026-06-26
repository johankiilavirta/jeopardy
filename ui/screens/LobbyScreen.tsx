import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SwipeUpMenu } from '../components/SwipeUpMenu';
import { MainMenuScreen } from './MainMenuScreen';
import { SettingsScreen } from './SettingsScreen';
import { colors, type as typeTokens } from '../theme/tokens';

export interface LobbyPlayer {
  peerId: string;
  name: string;
  isHost: boolean;
}

interface LobbyScreenProps {
  roomCode: number;
  players: LobbyPlayer[];
  isHost: boolean;
  onStart: () => void;
  onLeave: () => void;
  onNewGame?: () => void;
  onJoinGame?: () => void;
  playerName?: string;
  onNameChange?: (name: string) => void;
  relayHost?: string;
  onRelayHostChange?: (host: string) => void;
  relayPort?: string;
  onRelayPortChange?: (port: string) => void;
  gameId?: string;
  onGameIdChange?: (id: string) => void;
  error?: string | null;
}

const MAX_PLAYERS = 2;

export function LobbyScreen(props: LobbyScreenProps) {
  const canStart = props.isHost && props.players.length >= MAX_PLAYERS;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRound1, setShowRound1] = useState(false);
  const [showRound2, setShowRound2] = useState(false);
  const [round1Categories, setRound1Categories] = useState<{ name: string; imageClues: number }[] | null>(null);
  const [airDate, setAirDate] = useState<string | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [gameInfoStatus, setGameInfoStatus] = useState<'idle' | 'loading' | 'not-found'>('idle');

  useEffect(() => {
    const id = props.gameId;
    if (!id || !/^\d+$/.test(id) || Number(id) < 1) {
      setRound1Categories(null);
      setAirDate(null);
      setSeasonNumber(null);
      setGameInfoStatus('idle');
      return;
    }
    setGameInfoStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const host = props.relayHost ?? 'localhost';
        const port = props.relayPort ?? '8787';
        const res = await fetch(`http://${host}:${port}/game-info/${id}`);
        if (!res.ok) { setRound1Categories(null); setAirDate(null); setSeasonNumber(null); setGameInfoStatus('not-found'); return; }
        const data = await res.json() as { categories: { name: string; imageClues: number }[]; airDate: string; season: number };
        setRound1Categories(data.categories ?? null);
        setAirDate(data.airDate ?? null);
        setSeasonNumber(data.season ?? null);
        setGameInfoStatus(data.categories ? 'idle' : 'not-found');
      } catch {
        setRound1Categories(null);
        setAirDate(null);
        setSeasonNumber(null);
        setGameInfoStatus('not-found');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [props.gameId, props.relayHost, props.relayPort]);

  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => props.players[i] ?? null);

  return (
    <SwipeUpMenu
      renderMenu={showSettings => (
        <MainMenuScreen
          onNewGame={props.onNewGame ?? props.onLeave}
          onJoinGame={props.onJoinGame ?? props.onLeave}
          onSettings={showSettings}
        />
      )}
      renderSettings={goBack => (
        <SettingsScreen
          playerName={props.playerName ?? ''}
          onNameChange={props.onNameChange ?? (() => {})}
          relayHost={props.relayHost ?? 'localhost'}
          onRelayHostChange={props.onRelayHostChange ?? (() => {})}
          relayPort={props.relayPort ?? '8787'}
          onRelayPortChange={props.onRelayPortChange ?? (() => {})}
          onBack={goBack}
        />
      )}
    >
      <View style={styles.root}>
        <Pressable style={styles.leaveButton} onPress={props.onLeave}>
          <Text style={styles.leaveText}>← LEAVE</Text>
        </Pressable>

        {props.roomCode > 0 ? (
          <>
            <Text style={styles.roomCode}>{props.roomCode}</Text>
            <Text style={styles.subtitle}>Share this code with your friend</Text>
          </>
        ) : (
          <>
            <Text style={styles.creatingText}>Creating room...</Text>
            <Text style={styles.subtitle}> </Text>
          </>
        )}

        <View style={styles.playerList}>
          {slots.map((player, i) => (
            <View key={player?.peerId ?? `empty-${i}`} style={styles.playerRow}>
              <Text style={styles.slotLabel}>P{i + 1}</Text>
              {player ? (
                <>
                  <Text style={styles.playerName}>{player.name}</Text>
                  {player.isHost && <Text style={styles.hostBadge}>HOST</Text>}
                </>
              ) : (
                <Text style={styles.emptySlot}>Open</Text>
              )}
            </View>
          ))}
        </View>

        {props.isHost && (
          <>
            <Pressable
              style={[styles.startButton, !canStart && styles.startButtonDisabled]}
              onPress={props.onStart}
              disabled={!canStart}
            >
              <Text style={[styles.startButtonText, !canStart && styles.startButtonTextDisabled]}>
                START GAME
              </Text>
            </Pressable>

            <Pressable
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced(!showAdvanced)}
            >
              <Text style={styles.advancedToggleText}>
                {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
              </Text>
            </Pressable>

            {showAdvanced && (
              <View style={styles.advancedSection}>
                <Text style={styles.label}>Game #</Text>
                <TextInput
                  style={styles.input}
                  value={props.gameId ?? ''}
                  onChangeText={props.onGameIdChange ?? (() => {})}
                  placeholder="Random"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                />

                {gameInfoStatus === 'loading' && (
                  <Text style={styles.gameInfoNote}>Loading…</Text>
                )}
                {gameInfoStatus === 'not-found' && (
                  <Text style={styles.gameInfoNote}>Game not found</Text>
                )}

                {round1Categories && (
                  <>
                    {seasonNumber != null && (
                      <Text style={styles.gameMetadata}>Season {seasonNumber}</Text>
                    )}
                    {airDate && (
                      <Text style={styles.gameMetadata}>
                        {new Date(airDate + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </Text>
                    )}
                    <Pressable
                      style={styles.roundToggle}
                      onPress={() => setShowRound1(v => !v)}
                    >
                      <Text style={styles.roundToggleText}>
                        {showRound1 ? '▾ First Round' : '▸ First Round'}
                      </Text>
                    </Pressable>
                    {showRound1 && (
                      <ScrollView style={styles.categoryList} nestedScrollEnabled>
                        {round1Categories.map(({ name, imageClues }) => (
                          <View key={name} style={styles.categoryRow}>
                            <Text style={styles.categoryName}>{name}</Text>
                            {imageClues > 0 && (
                              <Text style={styles.imageClueCount}>{imageClues}/5</Text>
                            )}
                          </View>
                        ))}
                      </ScrollView>
                    )}

                    <Pressable
                      style={styles.roundToggle}
                      onPress={() => setShowRound2(v => !v)}
                    >
                      <Text style={styles.roundToggleText}>
                        {showRound2 ? '▾ Second Round' : '▸ Second Round'}
                      </Text>
                    </Pressable>
                    {showRound2 && (
                      <Text style={styles.gameInfoNote}>
                        Double Jeopardy categories not yet in dataset
                      </Text>
                    )}
                  </>
                )}
              </View>
            )}
          </>
        )}

        {props.error && (
          <View style={styles.statusLineWrap}>
            <Text style={styles.statusLine}>{props.error}</Text>
          </View>
        )}
      </View>
    </SwipeUpMenu>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  leaveButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
    zIndex: 1,
  },
  leaveText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.gold,
  },
  roomCode: {
    fontFamily: typeTokens.board,
    fontSize: 72,
    color: colors.gold,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#888',
    marginBottom: 32,
  },
  playerList: {
    width: '100%',
    maxWidth: 280,
    gap: 8,
    marginBottom: 32,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 6,
  },
  slotLabel: {
    fontFamily: typeTokens.ui700,
    fontSize: 14,
    color: '#555',
    marginRight: 12,
  },
  playerName: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    color: '#fff',
    flex: 1,
  },
  emptySlot: {
    fontFamily: typeTokens.ui500,
    fontSize: 18,
    color: '#444',
    fontStyle: 'italic',
    flex: 1,
  },
  hostBadge: {
    fontFamily: typeTokens.ui700,
    fontSize: 12,
    color: colors.gold,
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  creatingText: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.gold,
    marginBottom: 4,
  },
  statusLineWrap: {
    position: 'absolute',
    left: 24,
    bottom: 20,
    height: 40,
    justifyContent: 'center',
  },
  statusLine: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.65)',
  },
  advancedToggle: {
    marginTop: 24,
  },
  advancedToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#888',
  },
  advancedSection: {
    width: '100%',
    maxWidth: 280,
    marginBottom: 16,
  },
  label: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  input: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
  },
  gameMetadata: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#666',
    marginTop: 10,
  },
  roundToggle: {
    marginTop: 14,
  },
  roundToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
  },
  categoryList: {
    maxHeight: 160,
    marginTop: 4,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  categoryName: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#bbb',
  },
  imageClueCount: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#e87c1e',
  },
  gameInfoNote: {
    fontFamily: typeTokens.ui500,
    fontSize: 12,
    color: '#666',
    marginTop: 6,
    fontStyle: 'italic',
  },
  startButton: {
    backgroundColor: colors.cell,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 6,
  },
  startButtonDisabled: {
    opacity: 0.4,
  },
  startButtonText: {
    fontFamily: typeTokens.ui700,
    fontSize: 18,
    color: colors.gold,
  },
  startButtonTextDisabled: {
    color: '#666',
  },
});
