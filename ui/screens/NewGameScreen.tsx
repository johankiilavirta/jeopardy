import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, type as typeTokens } from '../theme/tokens';

const SCREEN_TOP_PADDING = 64;
const SCREEN_SIDE_PADDING = 32;
const TITLE_TO_CONTENT_GAP = 32;

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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Text style={styles.title}>NEW GAME</Text>
        <View style={styles.options}>
          <Pressable style={styles.option} onPress={onNearby}>
            <Text style={styles.optionTitle}>NEARBY</Text>
            <Text style={styles.optionDetail}>NO INTERNET REQUIRED</Text>
          </Pressable>
          <Pressable style={styles.option} onPress={onOnline}>
            <Text style={styles.optionTitle}>ONLINE</Text>
            <Text style={styles.optionDetail}>PLAY WITH A ROOM CODE</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1, width: '100%' },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: SCREEN_SIDE_PADDING,
    paddingTop: SCREEN_TOP_PADDING,
    paddingBottom: SCREEN_SIDE_PADDING,
  },
  backButton: { position: 'absolute', top: 16, left: 16, padding: 8, zIndex: 1 },
  backText: { fontFamily: typeTokens.ui500, fontSize: 16, color: colors.gold },
  title: { fontFamily: typeTokens.board, fontSize: 36, color: colors.gold, marginBottom: TITLE_TO_CONTENT_GAP },
  options: { width: '100%', alignItems: 'center', gap: 16 },
  option: { width: '100%', maxWidth: 360, padding: 22, backgroundColor: colors.cell, borderRadius: 8, alignItems: 'center' },
  optionTitle: { fontFamily: typeTokens.ui700, fontSize: 22, color: colors.gold },
  optionDetail: { fontFamily: typeTokens.ui500, fontSize: 12, color: '#aaa', marginTop: 4, letterSpacing: 1 },
});
