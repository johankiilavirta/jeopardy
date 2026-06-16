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

interface SettingsScreenProps {
  playerName: string;
  onNameChange: (name: string) => void;
  relayHost: string;
  onRelayHostChange: (host: string) => void;
  relayPort: string;
  onRelayPortChange: (port: string) => void;
  onBack: () => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={props.onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>SETTINGS</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Player Name</Text>
          <TextInput
            style={styles.input}
            value={props.playerName}
            onChangeText={props.onNameChange}
            placeholder="Your name"
            placeholderTextColor="#666"
            autoCorrect={false}
          />
        </View>

        <Pressable
          style={styles.advancedToggle}
          onPress={() => setShowAdvanced(!showAdvanced)}
        >
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
          </Text>
        </Pressable>

        {showAdvanced && (
          <View style={styles.section}>
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
            <Text style={styles.label}>Relay Port</Text>
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
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
    paddingBottom: 32,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 8,
  },
  backText: {
    fontFamily: typeTokens.ui500,
    fontSize: 16,
    color: colors.gold,
  },
  title: {
    fontFamily: typeTokens.board,
    fontSize: 36,
    color: colors.gold,
    marginBottom: 32,
  },
  section: {
    width: '100%',
    maxWidth: 280,
  },
  label: {
    fontFamily: typeTokens.ui500,
    fontSize: 13,
    color: '#888',
    marginBottom: 4,
    marginTop: 8,
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
    color: '#888',
  },
});
