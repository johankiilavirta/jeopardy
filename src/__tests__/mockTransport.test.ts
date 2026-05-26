import { describe, it, expect, vi } from 'vitest';
import { MockTransport } from '../mockTransport.js';

describe('MockTransport', () => {
  it('fires connect callbacks when linked', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');
    const aCb = vi.fn();
    const bCb = vi.fn();
    a.onPeerConnected(aCb);
    b.onPeerConnected(bCb);

    MockTransport.link(a, b);

    expect(aCb).toHaveBeenCalledWith('bob');
    expect(bCb).toHaveBeenCalledWith('alice');
  });

  it('delivers messages between linked peers', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');
    MockTransport.link(a, b);

    const received = vi.fn();
    b.onMessage(received);
    a.send('bob', '{"type":"BUZZ"}');

    expect(received).toHaveBeenCalledWith('alice', '{"type":"BUZZ"}');
  });

  it('broadcast sends to all connected peers', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');
    const c = new MockTransport('charlie');
    MockTransport.link(a, b);
    MockTransport.link(a, c);

    const bReceived = vi.fn();
    const cReceived = vi.fn();
    b.onMessage(bReceived);
    c.onMessage(cReceived);
    a.broadcast('hello');

    expect(bReceived).toHaveBeenCalledWith('alice', 'hello');
    expect(cReceived).toHaveBeenCalledWith('alice', 'hello');
  });

  it('does not deliver messages to unlinked peers', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');

    const received = vi.fn();
    b.onMessage(received);
    a.send('bob', 'nope');

    expect(received).not.toHaveBeenCalled();
  });

  it('fires disconnect callbacks when unlinked', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');
    MockTransport.link(a, b);

    const aCb = vi.fn();
    const bCb = vi.fn();
    a.onPeerDisconnected(aCb);
    b.onPeerDisconnected(bCb);

    MockTransport.unlink(a, b);

    expect(aCb).toHaveBeenCalledWith('bob');
    expect(bCb).toHaveBeenCalledWith('alice');
  });

  it('stops delivering messages after unlink', () => {
    const a = new MockTransport('alice');
    const b = new MockTransport('bob');
    MockTransport.link(a, b);
    MockTransport.unlink(a, b);

    const received = vi.fn();
    b.onMessage(received);
    a.send('bob', 'gone');

    expect(received).not.toHaveBeenCalled();
  });
});
