/**
 * One-command dev launcher: starts the relay and the Expo web app together,
 * wired so the app skips the menu/lobby and drops straight into a game.
 *
 *   npm run solo                 # solo, real game #1, web
 *   npm run solo -- --game=4321  # pick a J!Archive game number
 *   npm run solo -- --players=2  # wait for 2 tabs before starting
 *   npm run solo -- --room=42    # fixed room code (default 42)
 *
 * Open http://localhost:8081 (Expo prints the exact URL). For a 2-player
 * session, open a second browser tab at the same URL.
 */
import { spawn, type ChildProcess } from 'child_process';
import os from 'os';

function getLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();

function arg(name: string, fallback: string): string {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const room = arg('room', '123');
const players = arg('players', '1');
const game = arg('game', '1');

const env = {
  ...process.env,
  // Relay: allow a 1-player (solo) start.
  RELAY_ALLOW_SOLO: '1',
  // App: auto-create/join this room and auto-start once `players` are in.
  EXPO_PUBLIC_ROOM: room,
  EXPO_PUBLIC_PLAYERS: players,
  EXPO_PUBLIC_GAME: game,
  // Dynamically set packager hostname and relay host to current LAN IP
  REACT_NATIVE_PACKAGER_HOSTNAME: localIp,
  EXPO_PUBLIC_RELAY_HOST: localIp,
};

console.log(`\n  Solo dev: room ${room}, ${players} player(s), game #${game}\n`);

const children: ChildProcess[] = [];
function run(cmd: string, args: string[]): ChildProcess {
  // shell: true so `npx` resolves on Windows.
  const child = spawn(cmd, args, { env, stdio: 'inherit', shell: true });
  children.push(child);
  return child;
}

run('npx', ['tsx', 'relay/index.ts']);
run('npx', ['expo', 'start', '--web']);

function shutdown(): void {
  for (const c of children) c.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
