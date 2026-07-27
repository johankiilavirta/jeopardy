import type { GameData } from './gameLoader';

let importedGameCount = 0;
let importedGameLoader: (gameNumber: number) => GameData | null = () => null;

/** Injected by the native question-library module after it restores/imports
 * its file index. Keeping this tiny registry native-free lets loader tests
 * and board utilities run under Node. */
export function setImportedGameSource(
  gameCount: number,
  loader: (gameNumber: number) => GameData | null,
): void {
  importedGameCount = Math.max(0, Math.trunc(gameCount));
  importedGameLoader = loader;
}

export function getImportedGameCount(): number {
  return importedGameCount;
}

export function loadImportedGame(gameNumber: number): GameData | null {
  return importedGameLoader(gameNumber);
}
