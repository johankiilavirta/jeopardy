import { afterEach, describe, expect, it, vi } from 'vitest';
import { relayUrls } from '../../app/relayUrl';
import { DEFAULT_RELAY_HOST } from '../../app/relayDefaults';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('relayUrls', () => {
  it('uses the hosted relay as the installed-app default', () => {
    expect(relayUrls(DEFAULT_RELAY_HOST, '8787')).toEqual({
      ws: 'wss://jeopardy-relay-johan.fly.dev',
      http: 'https://jeopardy-relay-johan.fly.dev',
    });
  });

  it('builds ws/http URLs from a bare host and port', () => {
    expect(relayUrls('localhost', '8787')).toEqual({
      ws: 'ws://localhost:8787',
      http: 'http://localhost:8787',
    });
  });

  it('omits the port when the port field is blank', () => {
    expect(relayUrls('relay.example.com', '')).toEqual({
      ws: 'ws://relay.example.com',
      http: 'http://relay.example.com',
    });
  });

  it('uses secure schemes for a bare host on an https page', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(relayUrls('relay.example.com', '')).toEqual({
      ws: 'wss://relay.example.com',
      http: 'https://relay.example.com',
    });
  });

  it('keeps insecure schemes on an http page', () => {
    vi.stubGlobal('window', { location: { protocol: 'http:' } });
    expect(relayUrls('192.168.1.20', '8787').ws).toBe('ws://192.168.1.20:8787');
  });

  it('takes a full wss:// URL as-is and ignores the port field', () => {
    expect(relayUrls('wss://relay.fly.dev', '8787')).toEqual({
      ws: 'wss://relay.fly.dev',
      http: 'https://relay.fly.dev',
    });
  });

  it('maps an https:// host to wss for the socket', () => {
    expect(relayUrls('https://relay.fly.dev', '8787').ws).toBe('wss://relay.fly.dev');
  });

  it('keeps an explicit port embedded in a full URL', () => {
    expect(relayUrls('ws://relay.example.com:9000', '8787')).toEqual({
      ws: 'ws://relay.example.com:9000',
      http: 'http://relay.example.com:9000',
    });
  });

  it('trims whitespace and trailing slashes', () => {
    expect(relayUrls(' wss://relay.fly.dev/ ', '8787').ws).toBe('wss://relay.fly.dev');
    expect(relayUrls(' localhost ', ' 8787 ').ws).toBe('ws://localhost:8787');
  });
});
