/**
 * Build the WebSocket and HTTP URLs for reaching the relay from the
 * host/port settings.
 *
 * The host field accepts either:
 * - A bare hostname ("localhost", "192.168.1.20", "relay.fly.dev"). The
 *   port field is appended when non-empty. On a web page served over
 *   HTTPS the secure schemes (wss/https) are used, since browsers block
 *   insecure ws:// from secure pages (mixed content).
 * - A full URL ("wss://relay.fly.dev", "https://relay.example.com/path").
 *   Scheme and any embedded port are taken as-is and the port field is
 *   ignored, so a hosted relay behind TLS on 443 is just "wss://host".
 */
export function relayUrls(host: string, port: string): { ws: string; http: string } {
  const trimmed = host.trim().replace(/\/+$/, '');

  const match = trimmed.match(/^(wss?|https?):\/\/(.+)$/i);
  if (match?.[1] && match[2]) {
    const secure = /^(wss|https)$/i.test(match[1]);
    const rest = match[2];
    return {
      ws: `${secure ? 'wss' : 'ws'}://${rest}`,
      http: `${secure ? 'https' : 'http'}://${rest}`,
    };
  }

  // Bare hostname: pick schemes to match how the page itself is served.
  const secure = typeof window !== 'undefined'
    && window.location?.protocol === 'https:';
  const suffix = port.trim() ? `:${port.trim()}` : '';
  return {
    ws: `${secure ? 'wss' : 'ws'}://${trimmed}${suffix}`,
    http: `${secure ? 'https' : 'http'}://${trimmed}${suffix}`,
  };
}
