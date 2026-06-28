import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

const config: ExpoConfig = {
  ...appJson.expo,
  extra: {
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    relayHost: process.env.EXPO_PUBLIC_RELAY_HOST ?? 'localhost',
    room: process.env.EXPO_PUBLIC_ROOM,
    // Dev solo/auto-start: how many players to wait for before auto-starting
    // (default 1 = drop straight in), and which J!Archive game to load.
    players: process.env.EXPO_PUBLIC_PLAYERS,
    game: process.env.EXPO_PUBLIC_GAME,
  },
};

export default config;
