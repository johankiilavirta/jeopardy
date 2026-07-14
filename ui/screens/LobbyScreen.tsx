import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
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
  /** Master toggle for in-game animations (default on). */
  animationsEnabled?: boolean;
  onAnimationsChange?: (enabled: boolean) => void;
  /** How many category columns to show (4, 5, or 6). Default 6. */
  visibleCategories?: number | undefined;
  onVisibleCategoriesChange?: ((n: number) => void) | undefined;
  error?: string | null;
}

const MAX_PLAYERS = 2;

export function LobbyScreen(props: LobbyScreenProps) {
  const canStart = props.isHost && props.players.length >= MAX_PLAYERS;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRound1, setShowRound1] = useState(false);
  const [showRound2, setShowRound2] = useState(false);
  const [round1Categories, setRound1Categories] = useState<{ name: string; clueCount: number }[] | null>(null);
  const [round2Categories, setRound2Categories] = useState<{ name: string; clueCount: number }[] | null>(null);
  const [airDate, setAirDate] = useState<string | null>(null);
  const [seasonNumber, setSeasonNumber] = useState<number | null>(null);
  const [gameInfoStatus, setGameInfoStatus] = useState<'idle' | 'loading' | 'not-found'>('idle');

  // Animation for fading out the lobby
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const handleStartPress = useCallback(() => {
    if (!canStart) return;
    if (props.animationsEnabled === false) {
      props.onStart();
      return;
    }
    Animated.timing(contentOpacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      props.onStart();
    });
  }, [canStart, props, contentOpacity]);

  useEffect(() => {
    const id = props.gameId;
    if (!id || !/^\d+$/.test(id) || Number(id) < 1) {
      setRound1Categories(null);
      setRound2Categories(null);
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
        if (!res.ok) {
          setRound1Categories(null); setRound2Categories(null);
          setAirDate(null); setSeasonNumber(null);
          setGameInfoStatus('not-found'); return;
        }
        const data = await res.json() as {
          round1: { name: string; clueCount: number }[];
          round2: { name: string; clueCount: number }[];
          airDate: string;
          season: number;
        };
        setRound1Categories(data.round1 ?? null);
        setRound2Categories(data.round2 ?? null);
        setAirDate(data.airDate ?? null);
        setSeasonNumber(data.season ?? null);
        setGameInfoStatus(data.round1 ? 'idle' : 'not-found');
      } catch {
        setRound1Categories(null); setRound2Categories(null);
        setAirDate(null); setSeasonNumber(null);
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
        <Animated.View style={[StyleSheet.absoluteFill, styles.contentWrap, { opacity: contentOpacity }]}>
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
                onPress={handleStartPress}
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
                {showAdvanced ? '▾ Game Settings' : '▸ Game Settings'}
              </Text>
            </Pressable>

            {showAdvanced && (
              <View style={styles.advancedSection}>
                <Text style={styles.label}>Animations</Text>
                <Pressable
                  style={styles.toggleBox}
                  onPress={() =>
                    props.onAnimationsChange?.(!(props.animationsEnabled ?? true))
                  }
                >
                  <Text
                    style={[
                      styles.toggleText,
                      !(props.animationsEnabled ?? true) && styles.toggleTextOff,
                    ]}
                  >
                    {(props.animationsEnabled ?? true) ? 'On' : 'Off'}
                  </Text>
                </Pressable>

                <Text style={[styles.label, styles.stackedLabel]}>Categories Displayed</Text>
                <View style={styles.catCountRow}>
                  {([4, 5, 6] as const).map(n => {
                    const active = (props.visibleCategories ?? 6) === n;
                    return (
                      <Pressable
                        key={n}
                        style={[styles.catCountBtn, active && styles.catCountBtnActive]}
                        onPress={() => props.onVisibleCategoriesChange?.(n)}
                      >
                        <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                          {n}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.label, styles.stackedLabel]}>Game #</Text>
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
                        {showRound1 ? '▾ ' : '▸ '}
                        Jeopardy!
                        {round1Categories.some(c => c.clueCount < 5) && (
                          <Text style={styles.clueCount}> *</Text>
                        )}
                      </Text>
                    </Pressable>
                    {showRound1 && (
                      <ScrollView style={styles.categoryList} nestedScrollEnabled>
                        {round1Categories.map(({ name, clueCount }) => (
                          <View key={name} style={styles.categoryRow}>
                            <Text style={styles.categoryName}>{name}</Text>
                            {clueCount < 5 && (
                              <Text style={styles.clueCount}>{clueCount}/5</Text>
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
                        {showRound2 ? '▾ ' : '▸ '}
                        Double Jeopardy!
                        {round2Categories?.some(c => c.clueCount < 5) && (
                          <Text style={styles.clueCount}> *</Text>
                        )}
                      </Text>
                    </Pressable>
                    {showRound2 && round2Categories && (
                      <ScrollView style={styles.categoryList} nestedScrollEnabled>
                        {round2Categories.map(({ name, clueCount }) => (
                          <View key={name} style={styles.categoryRow}>
                            <Text style={styles.categoryName}>{name}</Text>
                            {clueCount < 5 && (
                              <Text style={styles.clueCount}>{clueCount}/5</Text>
                            )}
                          </View>
                        ))}
                      </ScrollView>
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
        </Animated.View>
      </View>
    </SwipeUpMenu>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  contentWrap: {
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
  stackedLabel: {
    marginTop: 16,
  },
  settingsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  settingsHalf: {
    flex: 1,
  },
  toggleBox: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
  },
  toggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
  },
  toggleTextOff: {
    color: '#666',
  },
  catCountRow: {
    flexDirection: 'row',
    gap: 6,
  },
  catCountBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  catCountBtnActive: {
    borderColor: '#fff',
    backgroundColor: '#222',
  },
  catCountText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#666',
  },
  catCountTextActive: {
    color: '#fff',
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
  clueCount: {
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
