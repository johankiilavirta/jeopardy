import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { normalizeForResume } from '../src/reducer.js';
import type { GameState } from '../src/types.js';
import { Room, RoomPlayer, RoomServerTransport } from './room.js';

const TOTAL_CLUES_DEMO = 25; // 5×5 fallback board

/** How long an in-progress room survives with zero players connected. */
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000;

// --- Game data lookup (runs server-side, loads files on demand) ---
// Assumes the relay is started from the project root (npm run relay).

interface GameIndex {
  totalGames: number;
  seasons: { file: string; startGame: number; endGame: number }[];
}

const DATA_DIR = path.resolve('data/seasons');
let _gameIndex: GameIndex | null = null;

interface RawClue { value: number; text: string; answer: string }
interface RawCategory { name: string; clues: RawClue[] }
interface RawGame { gameNumber: number; airDate: string; round1: RawCategory[]; round2: RawCategory[] }
const _seasonCache = new Map<string, RawGame[]>();

function getGameIndex(): GameIndex {
  if (!_gameIndex) {
    _gameIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  }
  return _gameIndex!;
}

function getRawGame(gameNumber: number): RawGame | null {
  try {
    const index = getGameIndex();
    const season = index.seasons.find(s => gameNumber >= s.startGame && gameNumber <= s.endGame);
    if (!season) return null;

    if (!_seasonCache.has(season.file)) {
      _seasonCache.set(season.file, JSON.parse(fs.readFileSync(path.join(DATA_DIR, season.file), 'utf8')));
    }

    return _seasonCache.get(season.file)!.find(g => g.gameNumber === gameNumber) ?? null;
  } catch {
    return null;
  }
}

interface CategoryInfo { name: string; clueCount: number }

interface GameInfo {
  airDate: string;
  season: number;
  round1: CategoryInfo[];
  round2: CategoryInfo[];
}

export interface CategoryData { name: string; clues: RawClue[] }

export interface FullGameData {
  gameNumber: number;
  airDate: string;
  season: number;
  round1: CategoryData[];
  round2: CategoryData[];
}

function lookupGame(gameNumber: number): GameInfo | null {
  const game = getRawGame(gameNumber);
  if (!game) return null;

  try {
    const index = getGameIndex();
    const season = index.seasons.find(s => gameNumber >= s.startGame && gameNumber <= s.endGame)!;
    const year = parseInt(season.file.replace('season-', '').replace('.json', ''), 10);
    const seasonNumber = year - 1983;
    const toInfo = (c: RawCategory): CategoryInfo => ({ name: c.name, clueCount: c.clues.length });

    return {
      airDate: game.airDate,
      season: seasonNumber,
      round1: game.round1.map(toInfo),
      round2: game.round2.map(toInfo),
    };
  } catch {
    return null;
  }
}

function lookupFullGame(gameNumber: number): FullGameData | null {
  const game = getRawGame(gameNumber);
  if (!game) return null;

  try {
    const index = getGameIndex();
    const season = index.seasons.find(s => gameNumber >= s.startGame && gameNumber <= s.endGame)!;
    const year = parseInt(season.file.replace('season-', '').replace('.json', ''), 10);
    const seasonNumber = year - 1983;

    return {
      gameNumber: game.gameNumber,
      airDate: game.airDate,
      season: seasonNumber,
      round1: game.round1,
      round2: game.round2,
    };
  } catch {
    return null;
  }
}

// --- Rooms ---

const rooms = new Map<number, Room>();
const peerToRoom = new Map<string, number>();
const peerToWs = new Map<string, WebSocket>();

function generateRoomCode(): number {
  for (let i = 0; i < 100; i++) {
    const code = 100 + Math.floor(Math.random() * 900);
    if (!rooms.has(code)) return code;
  }
  throw new Error('No room codes available');
}

function relaySend(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastLobbyUpdate(room: Room): void {
  const players = room.players.map(p => ({
    peerId: p.peerId,
    name: p.name,
    isHost: p.peerId === room.hostPeerId,
  }));
  for (const p of room.players) {
    relaySend(p.ws, { type: 'lobby-update', players });
  }
}

function removeFromRoom(peerId: string): void {
  const roomCode = peerToRoom.get(peerId);
  if (roomCode == null) return;

  const room = rooms.get(roomCode);
  peerToRoom.delete(peerId);
  if (!room) return;

  room.players = room.players.filter(p => p.peerId !== peerId);

  if (room.phase === 'playing') {
    // During game phase, notify the server transport
    room.serverTransport?.notifyDisconnect(peerId);
    for (const p of room.players) {
      relaySend(p.ws, { type: 'peer-disconnected', peerId });
    }
    if (room.players.length === 0) {
      // Don't dissolve immediately — both phones may have dropped at once
      // (locked screens on a train). Hold the room so they can rejoin.
      if (room.emptyTimer) clearTimeout(room.emptyTimer);
      room.emptyTimer = setTimeout(() => {
        if (room.players.length > 0) return;
        room.serverTransport?.stop();
        rooms.delete(roomCode);
        console.log(`  Room ${roomCode} dissolved (empty past grace period)`);
      }, EMPTY_ROOM_GRACE_MS);
      console.log(`  Room ${roomCode} empty — holding for ${EMPTY_ROOM_GRACE_MS / 1000}s`);
    }
  } else {
    // During lobby phase
    if (peerId === room.hostPeerId) {
      // Host left — dissolve room
      for (const p of room.players) {
        relaySend(p.ws, { type: 'room-error', message: 'Host left the room' });
        peerToRoom.delete(p.peerId);
      }
      rooms.delete(roomCode);
      console.log(`  Room ${roomCode} dissolved (host left)`);
    } else {
      broadcastLobbyUpdate(room);
    }
  }
}

// --- HTTP + WebSocket Server with dynamic port ---

const TRY_PORTS = [8787, 8788, 8789, 0];

function startServer(portIndex: number): void {
  const port = TRY_PORTS[portIndex];

  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const match = req.url?.match(/^\/game-info\/(\d+)$/);
    if (match) {
      const gameNumber = parseInt(match[1], 10);
      const info = lookupGame(gameNumber);
      res.writeHead(info ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(info));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  // ws re-emits server errors (e.g. EADDRINUSE) on the WebSocketServer;
  // without a listener that throws and kills the process before the
  // httpServer 'error' handler below can fall through to the next port.
  wss.on('error', () => {});

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && portIndex < TRY_PORTS.length - 1) {
      console.log(`Port ${port} in use, trying next...`);
      httpServer.close();
      startServer(portIndex + 1);
    } else {
      throw err;
    }
  });

  httpServer.listen(port, () => {
    const addr = httpServer.address();
    const actualPort = typeof addr === 'object' ? addr?.port : port;
    console.log(`Relay listening on ws://localhost:${actualPort}`);
  });

  let nextId = 1;

  wss.on('connection', (ws) => {
    const peerId = `peer-${nextId++}`;
    peerToWs.set(peerId, ws);

    console.log(`+ ${peerId} connected`);
    relaySend(ws, { type: 'welcome', peerId });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(raw)); } catch { return; }

      switch (msg.type) {
        case 'create-room': {
          // Honor a requested room code when it's free (dev shortcut so a
          // fixed EXPO_PUBLIC_ROOM is reproducible); otherwise allocate one.
          const requested = msg.roomCode != null ? Number(msg.roomCode) : null;
          const code = requested != null && !rooms.has(requested)
            ? requested
            : generateRoomCode();
          const room: Room = {
            code,
            hostPeerId: peerId,
            players: [{ peerId, name: String(msg.playerName ?? 'Host'), ws }],
            phase: 'lobby',
          };
          rooms.set(code, room);
          peerToRoom.set(peerId, code);
          console.log(`  Room ${code} created by ${peerId}`);
          relaySend(ws, { type: 'room-created', roomCode: code });
          broadcastLobbyUpdate(room);
          break;
        }

        case 'check-room': {
          const code = Number(msg.roomCode);
          const room = rooms.get(code);
          const joinable = !!room && room.players.length < 2;
          relaySend(ws, { type: 'room-check', roomCode: code, exists: joinable });
          break;
        }

        case 'join-room': {
          const code = Number(msg.roomCode);
          const room = rooms.get(code);
          if (!room) {
            relaySend(ws, { type: 'room-error', message: 'Room not found' });
            return;
          }
          if (room.players.length >= 2) {
            relaySend(ws, { type: 'room-error', message: 'Room is full' });
            return;
          }
          room.players.push({ peerId, name: String(msg.playerName ?? 'Guest'), ws });
          peerToRoom.set(peerId, code);
          if (room.emptyTimer) {
            clearTimeout(room.emptyTimer);
            room.emptyTimer = null;
          }
          console.log(`  ${peerId} joined room ${code}`);

          if (room.phase === 'playing') {
            // Rejoin a game in progress — skip lobby, go straight to game
            const playerName = String(msg.playerName ?? 'Guest');
            const serverPeerId = 'server';
            relaySend(ws, {
              type: 'game-started',
              serverPeerId,
              board: room.gameData ?? null,
              isResume: true,
            });
            room.serverTransport?.notifyConnect(peerId, playerName);
            // Notify existing players that someone reconnected
            for (const p of room.players) {
              if (p.peerId !== peerId) {
                relaySend(p.ws, { type: 'peer-connected', peerId });
              }
            }
            // If the room has only 1 connected player, it means the other player is disconnected.
            // Tell the rejoining player immediately so they show the disconnected status.
            if (room.players.length < 2) {
              relaySend(ws, { type: 'peer-disconnected', peerId: 'other' });
            }
          } else {
            broadcastLobbyUpdate(room);
          }
          break;
        }

        case 'start-game': {
          const roomCode = peerToRoom.get(peerId);
          if (roomCode == null) return;
          const room = rooms.get(roomCode);
          if (!room || room.phase !== 'lobby') return;
          if (room.hostPeerId !== peerId) {
            relaySend(ws, { type: 'room-error', message: 'Only the host can start' });
            return;
          }
          // Normally a game needs 2 players. RELAY_ALLOW_SOLO (set by the
          // `npm run solo` dev launcher) lets the host start solo for fast
          // single-player testing.
          const minPlayers = process.env.RELAY_ALLOW_SOLO ? 1 : 2;
          if (room.players.length < minPlayers) {
            relaySend(ws, { type: 'room-error', message: 'Need 2 players to start' });
            return;
          }

          // Resuming a saved game? The host sends the snapshot it kept on
          // device: the full GameState plus the board it was playing.
          const resume = msg.resume as { state?: GameState; board?: FullGameData | null } | undefined;
          const resumeState = resume?.state && typeof resume.state === 'object'
            && resume.state.players && Array.isArray(resume.state.burnedClueIds)
            ? normalizeForResume(resume.state)
            : null;
          if (resume && !resumeState) {
            relaySend(ws, { type: 'room-error', message: 'Saved game data is invalid' });
            return;
          }

          const gameId = msg.gameId ? Number(msg.gameId) : null;
          const gameData = resumeState
            ? (resume?.board ?? null)
            : gameId ? lookupFullGame(gameId) : null;
          // Count both rounds so the game spans Jeopardy! + Double Jeopardy!
          // and ends only when every clue (across both) is burned. Counts
          // actual clues, so incomplete categories are handled correctly.
          const countClues = (cats: CategoryData[]): number =>
            cats.reduce((n, c) => n + c.clues.length, 0);
          const totalClues = resumeState
            ? resumeState.totalClues
            : gameData
              ? countClues(gameData.round1) + countClues(gameData.round2)
              : TOTAL_CLUES_DEMO;

          room.phase = 'playing';
          room.gameData = gameData ?? null;
          const serverTransport = new RoomServerTransport(room);
          room.serverTransport = serverTransport;

          const playerNames = room.players.map(p => p.name);
          createServer(serverTransport, playerNames, {
            totalClues,
            ...(resumeState ? { initialState: resumeState } : {}),
          });

          const serverPeerId = 'server';
          console.log(`  Room ${roomCode} game ${resumeState ? 'resumed' : 'started'} (game #${gameId ?? 'demo'})`);

          // Notify all players, then simulate connections
          for (const p of room.players) {
            relaySend(p.ws, {
              type: 'game-started',
              serverPeerId,
              board: gameData ?? null,
              isResume: !!resumeState,
            });
          }
          for (const p of room.players) {
            serverTransport.notifyConnect(p.peerId, p.name);
          }
          break;
        }

        case 'send': {
          const roomCode = peerToRoom.get(peerId);
          if (roomCode == null) return;
          const room = rooms.get(roomCode);
          if (!room || room.phase !== 'playing' || !room.serverTransport) return;

          if (msg.to === 'server') {
            room.serverTransport.deliverMessage(peerId, String(msg.payload));
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      console.log(`- ${peerId} disconnected`);
      removeFromRoom(peerId);
      peerToWs.delete(peerId);
    });
  });
}

startServer(0);
