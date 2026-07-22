/**
 * Data exported from J!Archive is occasionally double-escaped, leaving
 * literal `\\`, `\\"`, or JSON unicode sequences visible in the game UI.
 * Decode those display artifacts without changing the stored game data.
 */
export function sanitizeText(value: string): string {
  let text = value;

  // Some records have been escaped twice, so decode at most twice. This keeps
  // a legitimate escaped backslash from being stripped indefinitely.
  for (let pass = 0; pass < 2; pass++) {
    const decoded = text
      .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/\\(["'\\/])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
    if (decoded === text) break;
    text = decoded;
  }

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}
