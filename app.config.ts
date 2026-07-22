import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

// Keep this literal here: Expo evaluates app.config.ts through CommonJS and
// does not resolve TypeScript-only imports outside the config itself.
const DEFAULT_RELAY_HOST = 'wss://jeopardy-relay-johan.fly.dev';

const config: ExpoConfig = {
  ...appJson.expo,
  ios: {
    bundleIdentifier: 'com.anonymous.jeopardy',
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'Jeopardy uses Bluetooth to host and join games with nearby players when Wi-Fi is unavailable.',
      NSLocalNetworkUsageDescription: 'Jeopardy uses your local network to find and join games hosted by nearby players.',
      NSBonjourServices: ['_jeopardy._tcp'],
    },
  },
  extra: {
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    relayHost: process.env.EXPO_PUBLIC_RELAY_HOST ?? DEFAULT_RELAY_HOST,
    room: process.env.EXPO_PUBLIC_ROOM,
    // Dev solo/auto-start: how many players to wait for before auto-starting
    // (default 1 = drop straight in), and which J!Archive game to load.
    players: process.env.EXPO_PUBLIC_PLAYERS,
    game: process.env.EXPO_PUBLIC_GAME,
    // UI lab: opens a reducer-backed visual fixture without the relay/menu.
    uiLab: !!process.env.EXPO_PUBLIC_UI_LAB,
    uiLabScreen: process.env.EXPO_PUBLIC_UI_LAB_SCREEN ?? 'board',
  },
};

export default config;
