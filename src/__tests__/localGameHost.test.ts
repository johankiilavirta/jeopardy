import { describe, expect, it } from 'vitest';
import { LocalGameHost } from '../../app/localGameHost';
import { createClient, sendAction } from '../client.js';
import type { Timer } from '../server.js';

function controlledTimer() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timer: Timer = {
    set(cb) {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    clear(id) {
      pending.delete(id as number);
    },
  };
  return {
    timer,
    count: () => pending.size,
    fire(index = 0) {
      const entry = [...pending.entries()][index];
      if (!entry) throw new Error(`no pending timer at index ${index}`);
      pending.delete(entry[0]);
      entry[1]();
    },
  };
}

const clue = {
  id: 1,
  category: 'Science',
  text: 'The closest planet to the Sun',
  answer: 'Mercury',
  value: 200,
};

describe('LocalGameHost', () => {
  it('hosts one authoritative game for two local client endpoints', () => {
    const host = new LocalGameHost(['Alice', 'Bob']);
    const aliceTransport = host.createClientEndpoint('alice-phone', 'Alice');
    const bobTransport = host.createClientEndpoint('bob-phone', 'Bob');
    const alice = createClient(aliceTransport);
    const bob = createClient(bobTransport);

    host.connectClient(aliceTransport);
    host.connectClient(bobTransport);

    expect(alice.playerId).toBe('alice');
    expect(bob.playerId).toBe('bob');
    expect(alice.state).toEqual(bob.state);
    expect(host.server.playerPeers).toEqual(new Map([
      ['alice-phone', 'alice'],
      ['bob-phone', 'bob'],
    ]));
  });

  it('round-trips actions through the host and broadcasts state to both phones', () => {
    const clock = controlledTimer();
    const host = new LocalGameHost(['Alice', 'Bob'], { timer: clock.timer });
    const aliceTransport = host.createClientEndpoint('alice-phone', 'Alice');
    const bobTransport = host.createClientEndpoint('bob-phone', 'Bob');
    const alice = createClient(aliceTransport);
    const bob = createClient(bobTransport);
    host.connectClient(aliceTransport);
    host.connectClient(bobTransport);

    sendAction(aliceTransport, host.serverPeerId, { type: 'SELECT_CLUE', clue });
    expect(alice.state?.status).toBe('CLUE_READING');
    expect(bob.state?.status).toBe('CLUE_READING');
    expect(alice.state?.clueSelectPlayerId).toBe('alice');

    clock.fire();
    sendAction(bobTransport, host.serverPeerId, { type: 'BUZZ', playerId: 'alice' });

    expect(alice.state?.buzzes[0]?.playerId).toBe('bob');
    expect(bob.state?.buzzes[0]?.playerId).toBe('bob');
  });

  it('reattaches a reconnecting device to its named seat and current state', () => {
    const host = new LocalGameHost(['Alice', 'Bob']);
    const firstPhone = host.createClientEndpoint('alice-phone-1', 'Alice');
    const firstClient = createClient(firstPhone);
    host.connectClient(firstPhone);
    sendAction(firstPhone, host.serverPeerId, { type: 'SKIP_CLUE', clueId: 7 });
    expect(firstClient.state?.burnedClueIds).toContain(7);

    host.disconnectClient(firstPhone);
    expect(host.server.playerPeers.has('alice-phone-1')).toBe(false);

    const replacementPhone = host.createClientEndpoint('alice-phone-2', 'Alice');
    const replacementClient = createClient(replacementPhone);
    host.connectClient(replacementPhone);

    expect(replacementClient.playerId).toBe('alice');
    expect(replacementClient.state?.burnedClueIds).toContain(7);
    expect(host.server.playerPeers.get('alice-phone-2')).toBe('alice');
  });

  it('disconnects clients and clears server timers when the local host stops', () => {
    const clock = controlledTimer();
    const host = new LocalGameHost(['Alice'], { timer: clock.timer });
    const phone = host.createClientEndpoint('alice-phone', 'Alice');
    let disconnected = false;
    phone.onPeerDisconnected(() => { disconnected = true; });
    createClient(phone);
    host.connectClient(phone);

    sendAction(phone, host.serverPeerId, { type: 'SELECT_CLUE', clue });
    expect(clock.count()).toBe(1);

    host.stop();

    expect(clock.count()).toBe(0);
    expect(disconnected).toBe(true);
  });
});
