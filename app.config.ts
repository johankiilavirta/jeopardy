import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

const config: ExpoConfig = {
  ...appJson.expo,
  extra: {
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    relayHost: process.env.EXPO_PUBLIC_RELAY_HOST ?? 'localhost',
  },
};

export default config;
