import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

interface NewGameScreenProps {
  onNearby: () => void;
  onOnline: () => void;
  onBack: () => void;
}

export function NewGameScreen({ onNearby, onOnline, onBack }: NewGameScreenProps) {
  return (
    <View style={styles.root}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← BACK</Text>
      </Pressable>
      <Text style={styles.title}>NEW GAME</Text>
      <Pressable style={styles.option} onPress={onNearby}>
        <Text style={styles.optionTitle}>NEARBY</Text>
        <Text style={styles.optionDetail}>NO INTERNET REQUIRED</Text>
      </Pressable>
      <Pressable style={styles.option} onPress={onOnline}>
        <Text style={styles.optionTitle}>ONLINE</Text>
        <Text style={styles.optionDetail}>PLAY WITH A ROOM CODE</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  backButton: { position: 'absolute', top: 16, left: 16, padding: 8 },
  backText: { fontFamily: typeTokens.ui500, fontSize: 16, color: colors.gold },
  title: { fontFamily: typeTokens.board, fontSize: 36, color: colors.gold, marginBottom: 16 },
  option: { width: '100%', maxWidth: 360, padding: 22, backgroundColor: colors.cell, borderRadius: 8, alignItems: 'center' },
  optionTitle: { fontFamily: typeTokens.ui700, fontSize: 22, color: colors.gold },
  optionDetail: { fontFamily: typeTokens.ui500, fontSize: 12, color: '#aaa', marginTop: 4, letterSpacing: 1 },
});

