import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export interface NearbyPeer {
  peerId: string;
  name: string;
  roomCode: number;
}

export interface NearbyNetworkEvents extends Record<string, (...args: any[]) => void> {
  onPeerFound: (peer: NearbyPeer) => void;
  onPeerLost: (event: { peerId: string }) => void;
  onPeerConnected: (event: { peerId: string }) => void;
  onPeerDisconnected: (event: { peerId: string }) => void;
  onMessage: (event: { peerId: string; message: string }) => void;
  onStateChanged: (event: { state: string }) => void;
  onError: (event: { message: string }) => void;
}

export interface NearbyNetworkNativeModule extends NativeModule<NearbyNetworkEvents> {
  addListener<K extends keyof NearbyNetworkEvents>(eventName: K, listener: NearbyNetworkEvents[K]): { remove(): void };
  host(roomCode: number, displayName: string): void;
  /** Pass the room code when it is known: Bluetooth hosts encode it in a
   *  derived service UUID that scanners must explicitly request to see
   *  (macOS drops the advertised local name). */
  browse(roomCode?: number): void;
  connect(peerId: string): void;
  send(peerId: string, message: string): void;
  stop(): void;
}

export default requireOptionalNativeModule<NearbyNetworkNativeModule>('NearbyNetwork');
export const BluetoothNetwork = requireOptionalNativeModule<NearbyNetworkNativeModule>('BluetoothNetwork');
