/**
 * Quick visual-feedback loop for UI work. It opens Expo Web straight in a
 * reducer-backed fixture, with no relay, room, menu, or lobby to traverse.
 *
 *   npm run ui                    # board fixture
 *   npm run ui -- --screen=clue   # a clue already on screen
 *   npm run ui -- --screen=judge  # answer-reveal / judging fixture
 *   npm run ui -- --screen=final-wager  # Final Jeopardy wager fixture
 */
import { spawn } from 'child_process';

const screenArg = process.argv.find(arg => arg.startsWith('--screen='));
const screen = screenArg?.slice('--screen='.length) ?? 'board';
const allowedScreens = new Set(['board', 'clue', 'judge', 'final-wager']);

if (!allowedScreens.has(screen)) {
  throw new Error(`Unknown UI lab screen "${screen}". Use board, clue, judge, or final-wager.`);
}

console.log(`\n  UI lab: ${screen} fixture (web, hot reload enabled)\n`);

spawn('npx', ['expo', 'start', '--web'], {
  env: {
    ...process.env,
    EXPO_PUBLIC_UI_LAB: 'true',
    EXPO_PUBLIC_UI_LAB_SCREEN: screen,
  },
  stdio: 'inherit',
  // Lets npx resolve correctly on Windows.
  shell: true,
});
