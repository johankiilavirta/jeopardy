import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

interface InGameSettingsScreenProps {
  onClose: () => void;
  animationsEnabled: boolean;
  onAnimationsChange: (enabled: boolean) => void;
  visibleCategories: number;
  onVisibleCategoriesChange: (n: number) => void;
  playerName: string;
  onNameChange: (name: string) => void;
  relayHost: string;
  onRelayHostChange: (host: string) => void;
  relayPort: string;
  onRelayPortChange: (port: string) => void;
}

export function InGameSettingsScreen(props: InGameSettingsScreenProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>SETTINGS</Text>
        <Pressable style={styles.closeButton} onPress={props.onClose}>
          <Text style={styles.closeText}>✕ CLOSE</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionHeading}>Game</Text>

        <Text style={styles.label}>Animations</Text>
        <Pressable
          style={styles.toggleBox}
          onPress={() => props.onAnimationsChange(!props.animationsEnabled)}
        >
          <Text style={[styles.toggleText, !props.animationsEnabled && styles.toggleTextOff]}>
            {props.animationsEnabled ? 'On' : 'Off'}
          </Text>
        </Pressable>

        <Text style={[styles.label, styles.stackedLabel]}>Categories Displayed</Text>
        <View style={styles.catCountRow}>
          {([4, 5, 6] as const).map(n => {
            const active = props.visibleCategories === n;
            return (
              <Pressable
                key={n}
                style={[styles.catCountBtn, active && styles.catCountBtnActive]}
                onPress={() => props.onVisibleCategoriesChange(n)}
              >
                <Text style={[styles.catCountText, active && styles.catCountTextActive]}>
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.sectionHeading, styles.stackedSection]}>Player</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={props.playerName}
          onChangeText={props.onNameChange}
          placeholder="Your name"
          placeholderTextColor="#666"
          autoCorrect={false}
        />

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
            <Text style={styles.label}>Relay Host</Text>
            <TextInput
              style={styles.input}
              value={props.relayHost}
              onChangeText={props.onRelayHostChange}
              placeholder="localhost"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[styles.label, styles.stackedLabel]}>Relay Port</Text>
            <TextInput
              style={styles.input}
              value={props.relayPort}
              onChangeText={props.onRelayPortChange}
              placeholder="8787"
              placeholderTextColor="#666"
              keyboardType="number-pad"
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 28,
    color: colors.gold,
  },
  closeButton: {
    padding: 8,
  },
  closeText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#888',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  sectionHeading: {
    fontFamily: typeTokens.ui700,
    fontSize: 11,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  stackedSection: {
    marginTop: 28,
  },
  label: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
  },
  stackedLabel: {
    marginTop: 14,
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
    gap: 8,
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
  input: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 6,
    padding: 10,
  },
  advancedToggle: {
    marginTop: 24,
  },
  advancedToggleText: {
    fontFamily: typeTokens.ui500,
    fontSize: 14,
    color: '#555',
  },
  advancedSection: {
    marginTop: 8,
  },
});
