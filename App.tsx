import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { DemoHarness } from './ui/demo/DemoHarness';
import { NetworkedGame } from './ui/networked/NetworkedGame';
import { colors } from './ui/theme/tokens';

const extra = Constants.expoConfig?.extra as { network?: boolean; relayHost?: string } | undefined;
const USE_NETWORK = !!extra?.network;

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
          {USE_NETWORK ? <NetworkedGame /> : <DemoHarness />}
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
