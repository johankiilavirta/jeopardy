import { spawn, execSync, type ChildProcess } from 'child_process';
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

const env = {
  ...process.env,
  RELAY_ALLOW_SOLO: '0',
  EXPO_PUBLIC_ROOM: '123',
  EXPO_PUBLIC_PLAYERS: '2',
  EXPO_PUBLIC_GAME: '1',
  FAST_FORWARD: '1',
  REACT_NATIVE_PACKAGER_HOSTNAME: localIp,
  EXPO_PUBLIC_RELAY_HOST: localIp,
};

console.log(`\n  Starting iOS Multi-Simulator Test (Fast Forward to Final Jeopardy)\n`);

const children: ChildProcess[] = [];
function run(cmd: string, args: string[]): ChildProcess {
  const child = spawn(cmd, args, { env, stdio: 'inherit', shell: true });
  children.push(child);
  return child;
}

run('npx', ['tsx', 'relay/index.ts']);
run('npx', ['expo', 'start']);

function shutdown(): void {
  for (const c of children) c.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Wait a bit for the bundler to start, then open URL on booted simulators
setTimeout(() => {
  try {
    const devicesOutput = execSync('xcrun simctl list devices available --json', { encoding: 'utf8' });
    const parsed = JSON.parse(devicesOutput);
    const devices = Object.values(parsed.devices).flat() as any[];
    
    let booted = devices.filter(d => d.state === 'Booted' || d.state === 'booted');
    
    if (booted.length < 2) {
      console.log(`\n[!] Only ${booted.length} simulator(s) booted. Booting up to 2 iPhone simulators automatically...\n`);
      const toBoot = devices.filter(d => (d.state === 'Shutdown' || d.state === 'shutdown') && d.name.includes('iPhone')).slice(0, 2 - booted.length);
      for (const d of toBoot) {
        console.log(`   Booting ${d.name}...`);
        try { execSync(`xcrun simctl boot ${d.udid}`); } catch (e) { /* ignore */ }
      }
      const newOutput = execSync('xcrun simctl list devices available --json', { encoding: 'utf8' });
      booted = (Object.values(JSON.parse(newOutput).devices).flat() as any[]).filter(d => d.state === 'Booted' || d.state === 'booted');
    }

    const expUrl = `exp://${localIp}:8081`;
    console.log(`\n=> Opening ${expUrl} on booted simulators...`);
    
    for (const device of booted) {
      console.log(`   Opening on ${device.name}...`);
      execSync(`xcrun simctl openurl ${device.udid} ${expUrl}`);
    }
  } catch (err) {
    console.error('Failed to open simulators:', err);
  }
}, 5000);
