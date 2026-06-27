import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from '../src/server.js';
import { Room, RoomPlayer, RoomServerTransport } from './room.js';

const TOTAL_CLUES_DEMO = 25; // 5×5 fallback board
const TOTAL_CLUES_REAL = 30; // 6×5 real board

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
      room.serverTransport?.stop();
      rooms.delete(roomCode);
      console.log(`  Room ${roomCode} dissolved (empty)`);
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
          // Optional fixed code (dev auto-launch). If that room already
          // exists, join it instead of creating — makes two clients sent to
          // the same code self-pair (relay processes messages serially, so
          // the first becomes host, the second joins; no race).
          const requested = msg.roomCode != null ? Number(msg.roomCode) : null;
          if (requested != null && rooms.has(requested)) {
            const room = rooms.get(requested)!;
            if (room.phase !== 'lobby') {
              relaySend(ws, { type: 'room-error', message: 'Game already started' });
              break;
            }
            if (room.players.length >= 2) {
              relaySend(ws, { type: 'room-error', message: 'Room is full' });
              break;
            }
            room.players.push({ peerId, name: String(msg.playerName ?? 'Guest'), ws });
            peerToRoom.set(peerId, requested);
            console.log(`  ${peerId} joined existing room ${requested} (create-or-join)`);
            broadcastLobbyUpdate(room);
            break;
          }

          const code = requested ?? generateRoomCode();
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
          console.log(`  ${peerId} joined room ${code}`);

          if (room.phase === 'playing') {
            // Rejoin a game in progress — skip lobby, go straight to game
            const playerName = String(msg.playerName ?? 'Guest');
            const serverPeerId = 'server';
            relaySend(ws, { type: 'game-started', serverPeerId });
            room.serverTransport?.notifyConnect(peerId, playerName);
            // Notify existing players that someone reconnected
            for (const p of room.players) {
              if (p.peerId !== peerId) {
                relaySend(p.ws, { type: 'peer-connected', peerId });
              }
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
          if (room.players.length < 2) {
            relaySend(ws, { type: 'room-error', message: 'Need 2 players to start' });
            return;
          }

          const gameId = msg.gameId ? Number(msg.gameId) : null;
          const gameData = gameId ? lookupFullGame(gameId) : null;
          const totalClues = gameData ? TOTAL_CLUES_REAL : TOTAL_CLUES_DEMO;

          room.phase = 'playing';
          const serverTransport = new RoomServerTransport(room);
          room.serverTransport = serverTransport;

          const playerNames = room.players.map(p => p.name);
          createServer(serverTransport, playerNames, { totalClues });

          const serverPeerId = 'server';
          console.log(`  Room ${roomCode} game started (game #${gameId ?? 'demo'})`);

          // Notify all players, then simulate connections
          for (const p of room.players) {
            relaySend(p.ws, { type: 'game-started', serverPeerId, board: gameData ?? null });
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
