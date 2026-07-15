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
  EXPO_PUBLIC_ROOM: '42',
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
    
    // Find booted devices
    const booted = devices.filter(d => d.state === 'Booted');
    
    if (booted.length < 2) {
      console.log(`\n[!] You only have ${booted.length} simulator(s) booted. Please boot another simulator using 'xcrun simctl boot <UUID>' or Simulator.app for the full 2-player experience.\n`);
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
