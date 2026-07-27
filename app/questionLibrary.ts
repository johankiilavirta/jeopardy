import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, FileMode, Paths } from 'expo-file-system';
import type { GameData } from '../data/gameLoader';
import { setImportedGameSource } from '../data/importedGameStore';

const LIBRARY_KEY = 'je-trivia/question-library-v1';
const LIBRARY_FILE_NAME = 'question-library.json';
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_GAME_BYTES = 512 * 1024;

interface QuestionFileEntry {
  gameNumber: number;
  airDate: string;
  offset: number;
  length: number;
}

interface SourceQuestionFileEntry extends QuestionFileEntry {
  file: File;
  sourceName: string;
}

interface StoredQuestionLibrary {
  version: 1;
  sourceName: string;
  importedAt: number;
  fileSize: number;
  entries: QuestionFileEntry[];
}

export interface QuestionLibraryInfo {
  sourceName: string;
  importedAt: number;
  fileSize: number;
  gameCount: number;
}

let activeLibrary: StoredQuestionLibrary | null = null;
const gameCache = new Map<number, GameData>();

function libraryFile(): File {
  return new File(Paths.document, LIBRARY_FILE_NAME);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCategory(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const category = value as { name?: unknown; clues?: unknown };
  if (!isNonEmptyString(category.name) || !Array.isArray(category.clues) || category.clues.length === 0 || category.clues.length > 5) {
    return false;
  }
  return category.clues.every(clue => {
    if (!clue || typeof clue !== 'object') return false;
    const item = clue as { value?: unknown; text?: unknown; answer?: unknown };
    return (
      typeof item.value === 'number' &&
      Number.isFinite(item.value) &&
      item.value > 0 &&
      isNonEmptyString(item.text) &&
      isNonEmptyString(item.answer)
    );
  });
}

export function isValidGameData(value: unknown): value is GameData {
  if (!value || typeof value !== 'object') return false;
  const game = value as {
    gameNumber?: unknown;
    airDate?: unknown;
    round1?: unknown;
    round2?: unknown;
    final?: unknown;
  };
  if (
    typeof game.gameNumber !== 'number' ||
    !Number.isInteger(game.gameNumber) ||
    game.gameNumber < 1 ||
    typeof game.airDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(game.airDate) ||
    !Array.isArray(game.round1) ||
    game.round1.length === 0 ||
    game.round1.length > 12 ||
    !game.round1.every(isValidCategory) ||
    !Array.isArray(game.round2) ||
    game.round2.length > 12 ||
    !game.round2.every(isValidCategory)
  ) {
    return false;
  }
  if (game.final == null) return true;
  if (typeof game.final !== 'object') return false;
  const final = game.final as { category?: unknown; text?: unknown; answer?: unknown };
  return isNonEmptyString(final.category) && isNonEmptyString(final.text) && isNonEmptyString(final.answer);
}

function decode(parts: Uint8Array[], length: number): string {
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(combined);
}

async function indexQuestionFile(file: File): Promise<QuestionFileEntry[]> {
  const handle = file.open(FileMode.ReadOnly);
  const entries: QuestionFileEntry[] = [];
  const seenNumbers = new Set<number>();
  let absoluteOffset = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let sawRootArray = false;
  let closedRootArray = false;
  let objectStart = -1;
  let objectPartStart = -1;
  let objectLength = 0;
  let objectParts: Uint8Array[] = [];

  try {
    while (true) {
      const chunk = handle.readBytes(READ_CHUNK_BYTES);
      if (chunk.length === 0) break;

      for (let index = 0; index < chunk.length; index++) {
        const byte = chunk[index]!;
        const position = absoluteOffset + index;

        if (inString) {
          if (escaped) escaped = false;
          else if (byte === 0x5c) escaped = true;
          else if (byte === 0x22) inString = false;
          continue;
        }

        if (byte === 0x22) {
          inString = true;
          continue;
        }

        if (byte === 0x5b) {
          if (!sawRootArray) {
            sawRootArray = true;
            depth = 1;
          } else {
            depth += 1;
          }
          continue;
        }

        if (byte === 0x7b) {
          if (depth === 1 && objectStart < 0) {
            objectStart = position;
            objectPartStart = index;
            objectLength = 0;
            objectParts = [];
          }
          depth += 1;
          continue;
        }

        if (byte === 0x7d) {
          depth -= 1;
          if (objectStart >= 0 && depth === 1) {
            if (objectPartStart < 0) throw new Error('Question file indexing failed');
            const finalPart = chunk.slice(objectPartStart, index + 1);
            objectParts.push(finalPart);
            objectLength += finalPart.length;
            if (objectLength > MAX_GAME_BYTES) throw new Error('A game in this file is too large');

            let parsed: unknown;
            try {
              parsed = JSON.parse(decode(objectParts, objectLength));
            } catch {
              throw new Error(`Invalid game JSON near byte ${objectStart}`);
            }
            if (!isValidGameData(parsed)) throw new Error(`Game near byte ${objectStart} has an unsupported format`);
            if (seenNumbers.has(parsed.gameNumber)) throw new Error(`Duplicate game number ${parsed.gameNumber}`);
            seenNumbers.add(parsed.gameNumber);
            entries.push({
              gameNumber: parsed.gameNumber,
              airDate: parsed.airDate,
              offset: objectStart,
              length: objectLength,
            });
            objectStart = -1;
            objectPartStart = -1;
            objectLength = 0;
            objectParts = [];
          }
          continue;
        }

        if (byte === 0x5d) {
          depth -= 1;
          if (depth === 0) closedRootArray = true;
        }
      }

      if (objectStart >= 0 && objectPartStart >= 0) {
        const part = chunk.slice(objectPartStart);
        objectParts.push(part);
        objectLength += part.length;
        if (objectLength > MAX_GAME_BYTES) throw new Error('A game in this file is too large');
        objectPartStart = 0;
      }
      absoluteOffset += chunk.length;
      // Let React Native paint the loading state while a large archive indexes.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally {
    handle.close();
  }

  if (!sawRootArray || !closedRootArray || depth !== 0 || inString || objectStart >= 0 || entries.length === 0) {
    throw new Error('Question file must be one JSON array of games');
  }
  return entries;
}

export function compareQuestionOrder(
  a: Pick<SourceQuestionFileEntry, 'airDate' | 'gameNumber' | 'sourceName' | 'offset'>,
  b: Pick<SourceQuestionFileEntry, 'airDate' | 'gameNumber' | 'sourceName' | 'offset'>,
): number {
  return (
    a.airDate.localeCompare(b.airDate) ||
    a.gameNumber - b.gameNumber ||
    a.sourceName.localeCompare(b.sourceName) ||
    a.offset - b.offset
  );
}

function readIndexedGame(file: File, entry: QuestionFileEntry): GameData {
  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = entry.offset;
    const bytes = handle.readBytes(entry.length);
    if (bytes.length !== entry.length) throw new Error(`Could not read game ${entry.gameNumber}`);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isValidGameData(parsed)) throw new Error(`Game ${entry.gameNumber} has an unsupported format`);
    return parsed;
  } finally {
    handle.close();
  }
}

async function buildChronologicalLibrary(
  sources: SourceQuestionFileEntry[],
  destination: File,
): Promise<QuestionFileEntry[]> {
  destination.create({ overwrite: true });
  const writer = destination.open(FileMode.WriteOnly);
  const encoder = new TextEncoder();
  const entries: QuestionFileEntry[] = [];

  try {
    writer.writeBytes(encoder.encode('['));
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index]!;
      const gameNumber = index + 1;
      const game = readIndexedGame(source.file, source);
      const bytes = encoder.encode(JSON.stringify({ ...game, gameNumber }));
      if (bytes.length > MAX_GAME_BYTES) throw new Error(`Game ${source.gameNumber} is too large after import`);
      if (index > 0) writer.writeBytes(encoder.encode(','));
      const offset = writer.offset;
      if (offset == null) throw new Error('Could not write the question library');
      writer.writeBytes(bytes);
      entries.push({ gameNumber, airDate: game.airDate, offset, length: bytes.length });

      // Let React Native paint progress while many seasons are merged.
      if (index % 25 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    writer.writeBytes(encoder.encode(']'));
  } finally {
    writer.close();
  }
  return entries;
}

export async function initializeQuestionLibrary(): Promise<QuestionLibraryInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredQuestionLibrary;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries) || !libraryFile().exists) {
      setImportedGameSource(0, () => null);
      return null;
    }
    activeLibrary = parsed;
    setImportedGameSource(parsed.entries.length, loadImportedGame);
    return getQuestionLibraryInfo();
  } catch {
    setImportedGameSource(0, () => null);
    return null;
  }
}

export async function importQuestionFile(): Promise<QuestionLibraryInfo | null> {
  const picked = await File.pickFileAsync({
    multipleFiles: true,
    mimeTypes: ['application/json', 'text/json', 'text/plain'],
  });
  if (picked.canceled) return null;
  const selectedFiles = picked.result;
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  if (
    selectedFiles.length === 0 ||
    selectedFiles.some(file => file.size <= 0 || file.size > MAX_FILE_BYTES) ||
    totalSize > MAX_FILE_BYTES
  ) {
    throw new Error('Choose non-empty JSON files totaling less than 250 MB');
  }

  const temporary = new File(Paths.document, `question-library-${Date.now()}.tmp`);
  try {
    const sources: SourceQuestionFileEntry[] = [];
    const seenGames = new Set<string>();
    for (const file of selectedFiles) {
      const entries = await indexQuestionFile(file);
      for (const entry of entries) {
        const identity = `${entry.airDate}\u0000${entry.gameNumber}`;
        if (seenGames.has(identity)) {
          throw new Error(`Game ${entry.gameNumber} from ${entry.airDate} appears in more than one selected file`);
        }
        seenGames.add(identity);
        sources.push({ ...entry, file, sourceName: file.name });
      }
    }
    sources.sort(compareQuestionOrder);
    const entries = await buildChronologicalLibrary(sources, temporary);
    const destination = libraryFile();
    await temporary.move(destination, { overwrite: true });
    const stored: StoredQuestionLibrary = {
      version: 1,
      sourceName: selectedFiles.length === 1 ? selectedFiles[0]!.name : `${selectedFiles.length} season files`,
      importedAt: Date.now(),
      fileSize: destination.size,
      entries,
    };
    await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(stored));
    activeLibrary = stored;
    gameCache.clear();
    setImportedGameSource(stored.entries.length, loadImportedGame);
    return getQuestionLibraryInfo();
  } catch (error) {
    if (temporary.exists) temporary.delete();
    throw error;
  }
}

export function getQuestionLibraryInfo(): QuestionLibraryInfo | null {
  if (!activeLibrary) return null;
  return {
    sourceName: activeLibrary.sourceName,
    importedAt: activeLibrary.importedAt,
    fileSize: activeLibrary.fileSize,
    gameCount: activeLibrary.entries.length,
  };
}

export function loadImportedGame(gameNumber: number): GameData | null {
  const cached = gameCache.get(gameNumber);
  if (cached) return cached;
  const entry = activeLibrary?.entries[gameNumber - 1];
  if (!entry || entry.gameNumber !== gameNumber) return null;
  const file = libraryFile();
  if (!file.exists) return null;

  const handle = file.open(FileMode.ReadOnly);
  try {
    handle.offset = entry.offset;
    const bytes = handle.readBytes(entry.length);
    if (bytes.length !== entry.length) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isValidGameData(parsed) || parsed.gameNumber !== gameNumber) return null;
    if (gameCache.size >= 8) gameCache.delete(gameCache.keys().next().value as number);
    gameCache.set(gameNumber, parsed);
    return parsed;
  } catch {
    return null;
  } finally {
    handle.close();
  }
}
