import { InProcessTransport } from '../src/inProcessTransport';
import { createServer, type GameServer, type ServerOptions } from '../src/server';

export const LOCAL_SERVER_PEER_ID = 'server';

/**
 * Owns an authoritative game server on the hosting device.
 *
 * Milestone 2 connects in-memory client endpoints. A later nearby adapter can
 * feed remote Network.framework peers into the same server-side boundary.
 */
export class LocalGameHost {
  readonly serverPeerId = LOCAL_SERVER_PEER_ID;
  readonly serverTransport = new InProcessTransport(LOCAL_SERVER_PEER_ID);
  readonly server: GameServer;

  constructor(playerNames: string[], options: ServerOptions = {}) {
    this.server = createServer(this.serverTransport, playerNames, options);
  }

  createClientEndpoint(peerId: string, playerName: string): InProcessTransport {
    return new InProcessTransport(peerId, playerName);
  }

  connectClient(endpoint: InProcessTransport): void {
    InProcessTransport.link(this.serverTransport, endpoint);
  }

  disconnectClient(endpoint: InProcessTransport): void {
    InProcessTransport.unlink(this.serverTransport, endpoint);
  }

  stop(): void {
    this.server.stop();
  }
}
