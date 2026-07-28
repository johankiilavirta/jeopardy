/**
 * On-device TTS spoken-form cache.
 *
 * When the user imports a question library on wifi, we send each clue's text
 * to the Gemini API and store the TTS-friendly spoken form alongside the
 * original. At play time the host device speaks the cached form; if no cache
 * entry exists (no wifi at import time, API error, etc.) it silently falls
 * back to the raw clue text.
 *
 * The original clue text shown on-screen is never modified.
 *
 * Cache file layout:
 *   documents/tts-cache.json  →  { version, processedGames, entries }
 * Entry keys: "${gameNumber}:${clueId}" for regular clues,
 *             "${gameNumber}:final"     for Final Jeopardy.
 */

import { File, FileMode, Paths } from 'expo-file-system';
import type { GameData } from '../data/gameLoader';
import { ROUND_STRIDE } from '../data/gameLoader';
import { clueIdAt } from '../ui/fixtures/board';

// ── Constants ──────────────────────────────────────────────────────────────

const CACHE_FILE_NAME = 'tts-cache.json';

/** Minimum ms between Gemini requests to stay within the free-tier 15 req/min limit. */
const GEMINI_RATE_LIMIT_MS = 4_100;

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.EXPO_PUBLIC_GEMINI_KEY ?? ''}`;

const SYSTEM_PROMPT = `You are preprocessing trivia clue text for a low-quality text-to-speech engine that cannot handle written shorthand. Convert each item to how it should be spoken aloud.

Rules:
- Expand dollar amounts: "$1,000" → "one thousand dollars", "$1.5 million" → "one point five million dollars"
- Expand abbreviations: "U.S." → "United States", "Mt." → "Mount", "St." → "Saint", "Dr." → "Doctor", "vs." → "versus", "No." → "Number"
- Expand Roman numerals in context: "XIV" → "the fourteenth", "Act II" → "Act the Second", "Henry VIII" → "Henry the Eighth"
- Spell out ordinals: "19th" → "nineteenth", "1st" → "first"
- For acronyms, use your best judgment — if commonly pronounced as a word (NASA, NATO, OPEC) leave as-is; if a naive TTS would awkwardly read it letter by letter, add periods so it spells out (FBI → F.B.I., CIA → C.I.A.)
- For years, use the natural spoken pair form: 1100–1999 read as two two-digit pairs ("1607" → "sixteen oh seven", "1682" → "sixteen eighty two", "1900" → "nineteen hundred"); 2000–2009 read as "two thousand [one/two/…]"; 2010 onward read as pair form ("2015" → "twenty fifteen", "2024" → "twenty twenty four"). Use context to decide if a number is a year or a plain count — plain counts use cardinal form
- Use your best judgment for wordplay, puns, or unusual capitalization/formatting that a naive TTS would mispronounce — format so the intended pronunciation is obvious
- Preserve all original words exactly — do not paraphrase, simplify, or change any actual content
- Return a JSON array of strings, one per input item, in the same order, with no extra commentary`;

// ── Types ──────────────────────────────────────────────────────────────────

interface TtsCacheFile {
  version: 1;
  /** Game numbers whose clues have been fully processed. */
  processedGames: number[];
  /** "gameNumber:clueId" or "gameNumber:final" → spoken text */
  entries: Record<string, string>;
}

interface ClueEntry {
  key: string;
  text: string;
}

// ── In-memory state ────────────────────────────────────────────────────────

let memoryEntries: Record<string, string> = {};
let processedGames = new Set<number>();

// ── Disk I/O ───────────────────────────────────────────────────────────────

function cacheFile(): File {
  return new File(Paths.document, CACHE_FILE_NAME);
}

function readCacheFromDisk(): TtsCacheFile | null {
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    const handle = file.open(FileMode.ReadOnly);
    try {
      const bytes = handle.readBytes(file.size);
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as TtsCacheFile;
      if (parsed.version !== 1) return null;
      return parsed;
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

function writeCacheToDisk(data: TtsCacheFile): void {
  const file = cacheFile();
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  file.create({ overwrite: true });
  const handle = file.open(FileMode.WriteOnly);
  try {
    handle.writeBytes(bytes);
  } finally {
    handle.close();
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load the persisted cache from disk into memory. Call once at app startup,
 * before any game is played.
 */
export function initializeTtsCache(): void {
  const data = readCacheFromDisk();
  if (data) {
    memoryEntries = data.entries;
    processedGames = new Set(data.processedGames);
  }
}

/**
 * Wipe the in-memory state and delete the cache file. Call when the user
 * imports a new question library so stale entries don't linger.
 */
export function clearTtsCache(): void {
  memoryEntries = {};
  processedGames = new Set();
  const file = cacheFile();
  if (file.exists) file.delete();
}

/**
 * Look up the TTS-friendly spoken form for a clue. Returns null if the clue
 * has not been cached — the caller should fall back to the raw clue text.
 *
 * @param gameNumber  The game's sequential number (1-based).
 * @param clueId      The numeric clue ID as assigned by clueIdAt/ROUND_STRIDE,
 *                    or the string "final" for the Final Jeopardy clue.
 */
export function lookupSpokenText(
  gameNumber: number,
  clueId: number | 'final',
): string | null {
  return memoryEntries[`${gameNumber}:${clueId}`] ?? null;
}

/**
 * Kick off background TTS cache generation for all un-processed games.
 * Returns immediately; processing happens asynchronously and persists each
 * game's results to disk as they complete. Failures are logged and skipped —
 * the caller will fall back to raw text at play time.
 *
 * @param getGame    Function that returns a GameData for a given game number,
 *                   or null if unavailable.
 * @param gameCount  Total number of games in the library (1-based).
 */
export function generateTtsCacheInBackground(
  getGame: (gameNumber: number) => GameData | null,
  gameCount: number,
): void {
  void (async () => {
    for (let gameNumber = 1; gameNumber <= gameCount; gameNumber++) {
      if (processedGames.has(gameNumber)) continue;

      const game = getGame(gameNumber);
      if (!game) continue;

      try {
        await processGame(game);
      } catch (error) {
        console.warn(`[ttsCache] Skipping game ${gameNumber}:`, error);
      }

      // Respect Gemini free-tier rate limit between requests.
      if (gameNumber < gameCount) {
        await new Promise<void>(resolve => setTimeout(resolve, GEMINI_RATE_LIMIT_MS));
      }
    }
  })();
}

// ── Internal ───────────────────────────────────────────────────────────────

function collectClues(game: GameData): ClueEntry[] {
  const entries: ClueEntry[] = [];

  const addRound = (round: GameData['round1'], roundNum: 1 | 2) => {
    const offset = (roundNum - 1) * ROUND_STRIDE;
    round.forEach((cat, col) => {
      cat.clues.forEach((clue, row) => {
        entries.push({
          key: `${game.gameNumber}:${offset + clueIdAt(col, row)}`,
          text: clue.text,
        });
      });
    });
  };

  addRound(game.round1, 1);
  addRound(game.round2, 2);
  if (game.final) {
    entries.push({ key: `${game.gameNumber}:final`, text: game.final.text });
  }

  return entries;
}

async function callGemini(texts: string[]): Promise<string[]> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_KEY;
  if (!apiKey) throw new Error('[ttsCache] EXPO_PUBLIC_GEMINI_KEY is not set');

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `${SYSTEM_PROMPT}\n\nInput:\n${JSON.stringify(texts)}`,
        }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`[ttsCache] Gemini API responded with ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('[ttsCache] Empty Gemini response');

  const result = JSON.parse(text) as unknown;
  if (!Array.isArray(result) || result.length !== texts.length) {
    throw new Error('[ttsCache] Gemini response length mismatch');
  }

  return result.map((item, i) =>
    typeof item === 'string' ? item : texts[i]!,
  );
}

async function processGame(game: GameData): Promise<void> {
  const clues = collectClues(game);
  if (clues.length === 0) return;

  const spokenForms = await callGemini(clues.map(c => c.text));

  const updated = { ...memoryEntries };
  clues.forEach((clue, i) => {
    const spoken = spokenForms[i];
    // Only store entries that differ from the original to save space.
    if (spoken && spoken !== clue.text) {
      updated[clue.key] = spoken;
    }
  });

  memoryEntries = updated;
  processedGames.add(game.gameNumber);

  writeCacheToDisk({
    version: 1,
    processedGames: Array.from(processedGames),
    entries: memoryEntries,
  });
}
