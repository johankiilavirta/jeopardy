/**
 * Download and convert jwolle1 J!Archive TSV files into per-season JSON bundles.
 *
 * Usage:
 *   npx tsx scripts/convert-jeopardy-data.ts
 *
 * Downloads the dataset zip from GitHub, extracts TSVs, converts to JSON,
 * and writes season files to data/seasons/ (committed with the app).
 *
 * TSV columns (tab-separated):
 *   round | clue_value | daily_double_value | category | comments |
 *   answer (= clue text) | question (= correct response) | air_date | notes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

// ── Types ──────────────────────────────────────────────────────────

interface RawClue {
  round: string;
  clueValue: number;
  category: string;
  text: string;      // "answer" column = clue text shown to players
  answer: string;    // "question" column = correct response
  airDate: string;
}

interface GameData {
  gameNumber: number;
  airDate: string;
  categories: {
    name: string;
    clues: { value: number; text: string; answer: string }[];
  }[];
}

interface SeasonIndex {
  totalGames: number;
  seasons: { file: string; startGame: number; endGame: number }[];
}

// ── Config ─────────────────────────────────────────────────────────

const DATASET_URL = 'https://github.com/jwolle1/jeopardy_clue_dataset/releases/download/v41/jeopardy_dataset_seasons_1-41.zip';
const RAW_DIR = path.join(__dirname, 'raw');
const OUT_DIR = path.join(__dirname, '..', 'data', 'seasons');

const VALUE_TIERS = [200, 400, 600, 800, 1000];
const MIN_CATEGORIES = 5; // games need at least 5 complete categories

// ── Download ───────────────────────────────────────────────────────

function download() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const zipPath = path.join(RAW_DIR, 'dataset.zip');

  // Check if TSVs already exist
  const existing = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.tsv'));
  if (existing.length > 0) {
    console.log(`Found ${existing.length} existing TSV file(s), skipping download`);
    return;
  }

  console.log('Downloading dataset...');
  execSync(`curl -L -o "${zipPath}" "${DATASET_URL}"`, { stdio: 'inherit' });

  console.log('Extracting...');
  execSync(`unzip -o "${zipPath}" -d "${RAW_DIR}"`, { stdio: 'inherit' });

  // The zip may contain a subdirectory — move TSVs to RAW_DIR root
  const findTsvs = (dir: string): string[] => {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsvs(fullPath));
      } else if (entry.name.endsWith('.tsv')) {
        results.push(fullPath);
      }
    }
    return results;
  };

  const tsvPaths = findTsvs(RAW_DIR);
  for (const tsvPath of tsvPaths) {
    const dest = path.join(RAW_DIR, path.basename(tsvPath));
    if (tsvPath !== dest) {
      fs.renameSync(tsvPath, dest);
    }
  }

  // Clean up zip
  fs.unlinkSync(zipPath);
  console.log(`Extracted ${tsvPaths.length} TSV file(s)`);
}

// ── Parsing ────────────────────────────────────────────────────────

function parseTsvLine(line: string): string[] {
  return line.split('\t');
}

function parseClue(fields: string[]): RawClue | null {
  const [round, clueValue, _dailyDouble, category, _comments, answer, question, airDate] = fields;
  if (!round || !category || !answer || !question || !airDate) return null;

  // Only Jeopardy round (round 1)
  if (round.trim() !== '1') return null;

  const value = parseInt(clueValue ?? '', 10);
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    round: round.trim(),
    clueValue: value,
    category: category.trim(),
    text: answer.trim(),
    answer: question.trim(),
    airDate: airDate.trim(),
  };
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  // 0. Download if needed
  download();

  // 1. Find TSV files
  const tsvFiles = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.tsv'))
    .sort();

  if (tsvFiles.length === 0) {
    console.error('No TSV files found after download. Something went wrong.');
    process.exit(1);
  }

  console.log(`Found ${tsvFiles.length} TSV file(s)`);

  // 2. Parse all clues across all season files
  const allClues: RawClue[] = [];

  for (const file of tsvFiles) {
    const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
    const lines = content.split('\n');

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;
      const fields = parseTsvLine(line);
      const clue = parseClue(fields);
      if (clue) allClues.push(clue);
    }
  }

  console.log(`Parsed ${allClues.length} round-1 clues`);

  // 3. Group clues by air_date (one game per date)
  const byDate = new Map<string, RawClue[]>();
  for (const clue of allClues) {
    let arr = byDate.get(clue.airDate);
    if (!arr) {
      arr = [];
      byDate.set(clue.airDate, arr);
    }
    arr.push(clue);
  }

  // 4. Build games from each date
  const games: GameData[] = [];

  const sortedDates = [...byDate.keys()].sort();

  for (const airDate of sortedDates) {
    const clues = byDate.get(airDate)!;

    // Group by category
    const byCat = new Map<string, RawClue[]>();
    for (const clue of clues) {
      let arr = byCat.get(clue.category);
      if (!arr) {
        arr = [];
        byCat.set(clue.category, arr);
      }
      arr.push(clue);
    }

    // Need at least 5 categories to be usable
    if (byCat.size < MIN_CATEGORIES) continue;

    // Build category objects, keeping only those with all 5 value tiers
    const categories: GameData['categories'] = [];

    for (const [catName, catClues] of byCat) {
      // Map clue values to standard tiers
      // Early seasons used $100-$500, later $200-$1000
      const sortedClues = [...catClues].sort((a, b) => a.clueValue - b.clueValue);

      if (sortedClues.length < 5) continue;

      // Take the first 5 unique values (sorted ascending) and assign standard values
      const tierClues: { value: number; text: string; answer: string }[] = [];
      const usedValues = new Set<number>();

      for (const clue of sortedClues) {
        if (usedValues.has(clue.clueValue)) continue;
        usedValues.add(clue.clueValue);
        if (tierClues.length < 5) {
          tierClues.push({
            value: VALUE_TIERS[tierClues.length]!,
            text: clue.text,
            answer: clue.answer,
          });
        }
      }

      if (tierClues.length === 5) {
        categories.push({ name: catName, clues: tierClues });
      }
    }

    // Keep all complete categories — the game decides how many to use
    if (categories.length < MIN_CATEGORIES) continue;

    games.push({
      gameNumber: 0, // assigned below
      airDate,
      categories,
    });
  }

  // 5. Assign sequential game numbers
  for (let i = 0; i < games.length; i++) {
    games[i]!.gameNumber = i + 1;
  }

  console.log(`Built ${games.length} complete games`);

  // 6. Group games by season (based on air date year)
  const bySeason = new Map<number, GameData[]>();

  for (const game of games) {
    const year = parseInt(game.airDate.substring(0, 4), 10);
    if (!Number.isFinite(year)) continue;
    let arr = bySeason.get(year);
    if (!arr) {
      arr = [];
      bySeason.set(year, arr);
    }
    arr.push(game);
  }

  // 7. Write output files
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const seasonKeys = [...bySeason.keys()].sort((a, b) => a - b);
  const index: SeasonIndex = { totalGames: games.length, seasons: [] };

  for (const year of seasonKeys) {
    const seasonGames = bySeason.get(year)!;
    const fileName = `season-${year}.json`;
    const filePath = path.join(OUT_DIR, fileName);

    fs.writeFileSync(filePath, JSON.stringify(seasonGames));

    const startGame = seasonGames[0]!.gameNumber;
    const endGame = seasonGames[seasonGames.length - 1]!.gameNumber;

    index.seasons.push({ file: fileName, startGame, endGame });

    const sizeMB = (Buffer.byteLength(JSON.stringify(seasonGames)) / 1024 / 1024).toFixed(2);
    console.log(`  ${fileName}: ${seasonGames.length} games (${sizeMB} MB)`);
  }

  const indexPath = path.join(OUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log(`\nWrote index.json with ${index.seasons.length} season files`);
  const totalClues = games.reduce((sum, g) => sum + g.categories.length * 5, 0);
  console.log(`Total: ${games.length} games, ${totalClues} clues`);
}

main();
