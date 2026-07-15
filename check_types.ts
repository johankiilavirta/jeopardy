import fs from 'fs';
import path from 'path';

function findTypes(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findTypes(fullPath);
    } else if (file.endsWith('.d.ts')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('TimingAnimationConfig')) {
        console.log('Found TimingAnimationConfig in', fullPath);
        const lines = content.split('\n');
        const start = lines.findIndex(l => l.includes('interface TimingAnimationConfig'));
        if (start !== -1) {
          console.log(lines.slice(start, start + 20).join('\n'));
        }
      }
    }
  }
}
findTypes('node_modules/@types/react-native');
