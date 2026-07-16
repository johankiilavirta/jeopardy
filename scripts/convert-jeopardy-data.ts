/**
 * Download and convert jwolle1 J!Archive TSV files into per-season JSON bundles.
 *
 * Usage:
 *   npx tsx scripts/convert-jeopardy-data.ts
 *
 * TSV columns (tab-separated):
 *   round | clue_value | daily_double_value | category | comments |
 *   answer (= clue text) | question (= correct response) | air_date | notes
 *
 * Rounds in the dataset:
 *   1 = Jeopardy! round     ($200/$400/$600/$800/$1000, normalized)
 *   2 = Double Jeopardy!    ($400/$800/$1200/$1600/$2000, normalized)
 *   3 = Final Jeopardy!     (single clue, skipped)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────────

interface RawClue {
  round: '1' | '2' | '3';
  clueValue: number;
  category: string;
  text: string;      // "answer" column = clue text shown to players
  answer: string;    // "question" column = correct response
  airDate: string;
}

interface CategoryData {
  name: string;
  clues: { value: number; text: string; answer: string }[];
}

interface GameData {
  gameNumber: number;
  airDate: string;
  round1: CategoryData[];
  round2: CategoryData[];
  final?: { category: string; text: string; answer: string };
}

interface SeasonIndex {
  totalGames: number;
  seasons: { file: string; startGame: number; endGame: number }[];
}

// ── Config ─────────────────────────────────────────────────────────

const DATASET_URL = 'https://github.com/jwolle1/jeopardy_clue_dataset/releases/download/v41/jeopardy_dataset_seasons_1-41.zip';
const RAW_DIR = path.join(__dirname, 'raw');
const OUT_DIR = path.join(__dirname, '..', 'data', 'seasons');

// Standard value tiers per round (position-based normalization handles
// early seasons that used different dollar amounts).
const R1_VALUE_TIERS = [200, 400, 600, 800, 1000];
const R2_VALUE_TIERS = [400, 800, 1200, 1600, 2000];

// Minimum complete clues required to keep a category. 4 instead of 5
// because jwolle1 omits clues that were pure image links on J!Archive,
// leaving otherwise valid categories one clue short.
const MIN_CLUES_PER_CATEGORY = 4;

// A game must have at least this many round-1 categories to be kept.
const MIN_R1_CATEGORIES = 5;

// ── Download ───────────────────────────────────────────────────────

function download() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // Only look for per-season TSVs (season1.tsv … season41.tsv).
  // The zip also contains combined_season1-41.tsv and other files —
  // we ignore those to avoid double-counting clues.
  const existing = fs.readdirSync(RAW_DIR).filter(f => /^season\d+\.tsv$/.test(f));
  if (existing.length > 0) {
    console.log(`Found ${existing.length} existing season TSV(s), skipping download`);
    return;
  }

  const zipPath = path.join(RAW_DIR, 'dataset.zip');
  console.log('Downloading dataset...');
  execSync(`curl -L -o "${zipPath}" "${DATASET_URL}"`, { stdio: 'inherit' });

  console.log('Extracting...');
  execSync(`unzip -o "${zipPath}" -d "${RAW_DIR}"`, { stdio: 'inherit' });
  fs.unlinkSync(zipPath);

  // Move only the per-season TSVs out of the nested subdirectory.
  const findSeasonTsvs = (dir: string): string[] => {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findSeasonTsvs(fullPath));
      else if (/^season\d+\.tsv$/.test(entry.name)) results.push(fullPath);
    }
    return results;
  };

  const tsvPaths = findSeasonTsvs(RAW_DIR);
  for (const tsvPath of tsvPaths) {
    const dest = path.join(RAW_DIR, path.basename(tsvPath));
    if (tsvPath !== dest) fs.renameSync(tsvPath, dest);
  }

  console.log(`Extracted ${tsvPaths.length} season TSV(s)`);
}

// ── Parsing ────────────────────────────────────────────────────────

function parseClue(fields: string[]): RawClue | null {
  const [round, clueValue, _dailyDouble, category, _comments, answer, question, airDate] = fields;
  if (!round || !category || !answer || !question || !airDate) return null;

  const r = round.trim();
  if (r !== '1' && r !== '2' && r !== '3') return null;

  const value = parseInt(clueValue ?? '', 10);
  if (r !== '3' && (!Number.isFinite(value) || value <= 0)) return null;

  return {
    round: r as '1' | '2' | '3',
    clueValue: r === '3' ? 0 : value,
    category: category.trim(),
    text: answer.trim(),
    answer: question.trim(),
    airDate: airDate.trim(),
  };
}

// ── Category building ──────────────────────────────────────────────

function buildCategories(
  clues: RawClue[],
  round: '1' | '2',
  valueTiers: number[],
): CategoryData[] {
  const byCat = new Map<string, RawClue[]>();
  for (const clue of clues) {
    if (clue.round !== round) continue;
    const arr = byCat.get(clue.category) ?? [];
    arr.push(clue);
    byCat.set(clue.category, arr);
  }

  const categories: CategoryData[] = [];
  for (const [name, catClues] of byCat) {
    const sorted = [...catClues].sort((a, b) => a.clueValue - b.clueValue);

    // Deduplicate by value (daily doubles can create two entries at the same tier).
    const tierClues: CategoryData['clues'] = [];
    const usedValues = new Set<number>();
    for (const clue of sorted) {
      if (usedValues.has(clue.clueValue)) continue;
      usedValues.add(clue.clueValue);
      if (tierClues.length < 5) {
        tierClues.push({
          value: valueTiers[tierClues.length]!,
          text: clue.text,
          answer: clue.answer,
        });
      }
    }

    if (tierClues.length >= MIN_CLUES_PER_CATEGORY) {
      categories.push({ name, clues: tierClues });
    }
  }

  return categories;
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  download();

  const tsvFiles = fs.readdirSync(RAW_DIR)
    .filter(f => /^season\d+\.tsv$/.test(f))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace(/\D/g, ''), 10);
      return n(a) - n(b);
    });

  if (tsvFiles.length === 0) {
    console.error('No season TSV files found. Something went wrong with the download.');
    process.exit(1);
  }

  console.log(`Processing ${tsvFiles.length} season TSV(s)...`);

  // Parse all clues from all seasons.
  const allClues: RawClue[] = [];
  for (const file of tsvFiles) {
    const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const clue = parseClue(line.split('\t'));
      if (clue) allClues.push(clue);
    }
  }

  console.log(`Parsed ${allClues.length} clues (rounds 1 & 2)`);

  // Group by air date.
  const byDate = new Map<string, RawClue[]>();
  for (const clue of allClues) {
    const arr = byDate.get(clue.airDate) ?? [];
    arr.push(clue);
    byDate.set(clue.airDate, arr);
  }

  // Build game objects.
  const games: GameData[] = [];
  for (const airDate of [...byDate.keys()].sort()) {
    const clues = byDate.get(airDate)!;

    const round1 = buildCategories(clues, '1', R1_VALUE_TIERS);
    const round2 = buildCategories(clues, '2', R2_VALUE_TIERS);
    const finalClue = clues.find(c => c.round === '3');

    if (round1.length < MIN_R1_CATEGORIES) continue;

    const game: GameData = { gameNumber: 0, airDate, round1, round2 };
    if (finalClue) {
      game.final = {
        category: finalClue.category,
        text: finalClue.text,
        answer: finalClue.answer,
      };
    }
    games.push(game);
  }

  // Assign sequential game numbers by air date.
  for (let i = 0; i < games.length; i++) games[i]!.gameNumber = i + 1;

  console.log(`Built ${games.length} games`);

  // Group by calendar year for per-season output files.
  const bySeason = new Map<number, GameData[]>();
  for (const game of games) {
    const year = parseInt(game.airDate.substring(0, 4), 10);
    if (!Number.isFinite(year)) continue;
    const arr = bySeason.get(year) ?? [];
    arr.push(game);
    bySeason.set(year, arr);
  }

  // Write output.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const seasonKeys = [...bySeason.keys()].sort((a, b) => a - b);
  const index: SeasonIndex = { totalGames: games.length, seasons: [] };

  for (const year of seasonKeys) {
    const seasonGames = bySeason.get(year)!;
    const fileName = `season-${year}.json`;
    fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(seasonGames));

    index.seasons.push({
      file: fileName,
      startGame: seasonGames[0]!.gameNumber,
      endGame: seasonGames[seasonGames.length - 1]!.gameNumber,
    });

    const sizeMB = (Buffer.byteLength(JSON.stringify(seasonGames)) / 1024 / 1024).toFixed(2);
    const r1total = seasonGames.reduce((s, g) => s + g.round1.length, 0);
    const r2total = seasonGames.reduce((s, g) => s + g.round2.length, 0);
    console.log(`  ${fileName}: ${seasonGames.length} games, ${r1total} R1 cats, ${r2total} R2 cats (${sizeMB} MB)`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\nWrote index.json with ${index.seasons.length} seasons`);
}

main();
