import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const paths = readFileSync('.mypaths', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

if (paths.length === 0) {
  console.error('No paths found in .mypaths');
  process.exit(1);
}

const pathArgs = paths.map(p => `"${p}"`).join(' ');
execSync(`tsx src/index.ts --threshold=5 --output=imgs.json ${pathArgs}`, { stdio: 'inherit' });
execSync('tsx src/report.ts --input=imgs.json --output=report.html', { stdio: 'inherit' });
