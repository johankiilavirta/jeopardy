const appJson = require('./app.json');

// Keep the packaged default self-contained so local and cloud builds use the
// same relay endpoint without loading app code.
const DEFAULT_RELAY_HOST = 'wss://je-trivia-relay-johan.fly.dev';

module.exports = {
  ...appJson.expo,
  ios: {
    bundleIdentifier: 'com.johank.jetrivia',
    infoPlist: {
      NSBluetoothAlwaysUsageDescription: 'JE Trivia uses Bluetooth to host and join games with nearby players when Wi-Fi is unavailable.',
      NSLocalNetworkUsageDescription: 'JE Trivia uses your local network to find and join games hosted by nearby players.',
      NSBonjourServices: ['_jetrivia._tcp'],
    },
  },
  extra: {
    eas: {
      projectId: 'f380b3c9-8e1e-4d18-a86e-739a8a553ceb',
    },
    network: !!process.env.EXPO_PUBLIC_NETWORK,
    // Online/relay play is intentionally absent from the first public build.
    // Developers can opt it back in without deleting the existing relay path.
    enableOnline: process.env.EXPO_PUBLIC_ENABLE_ONLINE === '1',
    relayHost: process.env.EXPO_PUBLIC_RELAY_HOST ?? DEFAULT_RELAY_HOST,
    room: process.env.EXPO_PUBLIC_ROOM,
    // Dev solo/auto-start: how many players to wait for before auto-starting
    // (default 1 = drop straight in), and which source game to load.
    players: process.env.EXPO_PUBLIC_PLAYERS,
    game: process.env.EXPO_PUBLIC_GAME,
    // UI lab: opens a reducer-backed visual fixture without the relay/menu.
    uiLab: !!process.env.EXPO_PUBLIC_UI_LAB,
    uiLabScreen: process.env.EXPO_PUBLIC_UI_LAB_SCREEN ?? 'board',
  },
};
