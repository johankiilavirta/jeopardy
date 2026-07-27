/**
 * Build one private, importable question file from the repository's existing
 * per-season JSON arrays. The output keeps the exact GameData[] JSON shape
 * accepted by Settings > Question File.
 *
 * The destination is gitignored and is not referenced by Metro, so generating
 * it does not add the archive to the mobile app bundle.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface SeasonIndex {
  seasons: { file: string }[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(scriptDirectory, '..');
const seasonsDirectory = path.join(projectRoot, 'data', 'seasons');
const outputDirectory = path.join(projectRoot, 'private-question-files');
const outputFile = path.join(outputDirectory, 'jest-trivia-games.json');

function arrayContents(raw: string, fileName: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`${fileName} is not a JSON array`);
  }
  return trimmed.slice(1, -1).trim();
}

function main(): void {
  const index = JSON.parse(
    fs.readFileSync(path.join(seasonsDirectory, 'index.json'), 'utf8'),
  ) as SeasonIndex;
  fs.mkdirSync(outputDirectory, { recursive: true });

  const fd = fs.openSync(outputFile, 'w');
  let wroteGame = false;
  try {
    fs.writeSync(fd, '[');
    for (const season of index.seasons) {
      const contents = arrayContents(
        fs.readFileSync(path.join(seasonsDirectory, season.file), 'utf8'),
        season.file,
      );
      if (!contents) continue;
      if (wroteGame) fs.writeSync(fd, ',');
      fs.writeSync(fd, contents);
      wroteGame = true;
    }
    fs.writeSync(fd, ']');
  } finally {
    fs.closeSync(fd);
  }

  const sizeMb = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${outputFile} (${sizeMb} MB)`);
}

main();
