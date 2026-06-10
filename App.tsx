import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { DemoHarness } from './ui/demo/DemoHarness';
import { colors } from './ui/theme/tokens';

export default function App() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    Oswald_500Medium,
    Oswald_700Bold,
  });

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      {fontsLoaded ? (
        <SafeAreaView style={styles.root}>
          <DemoHarness />
        </SafeAreaView>
      ) : (
        <View style={styles.root} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
