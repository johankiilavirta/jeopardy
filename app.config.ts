import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';

// Expo evaluates this config through CommonJS, so keep the packaged default
// self-contained rather than importing the app's TypeScript helper.
const DEFAULT_RELAY_HOST = 'wss://jest-trivia-relay-johan.fly.dev';

const config: ExpoConfig = {
  ...appJson.expo,
  ios: {
    bundleIdentifier: 'com.anonymous.jesttrivia',
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'Jest Trivia uses Bluetooth to host and join games with nearby players when Wi-Fi is unavailable.',
      NSLocalNetworkUsageDescription: 'Jest Trivia uses your local network to find and join games hosted by nearby players.',
      NSBonjourServices: ['_jesttrivia._tcp'],
    },
  },
  extra: {
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    // Online/relay play is intentionally absent from the first public build.
    // Developers can opt it back in without deleting the existing relay path.
    enableOnline: process.env.EXPO_PUBLIC_ENABLE_ONLINE === '1',
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
