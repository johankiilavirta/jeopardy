import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

const config: ExpoConfig = {
  ...appJson.expo,
  extra: {
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    relayHost: process.env.EXPO_PUBLIC_RELAY_HOST ?? 'localhost',
    room: process.env.EXPO_PUBLIC_ROOM,
    game: process.env.EXPO_PUBLIC_GAME,
  },
};

export default config;
