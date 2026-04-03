import { findDuplicates, findSimilar, type DuplicateGroup } from './scan.js';
import { HashCache } from './cache.js';

const args = process.argv.slice(2);
const exactMode = args.includes('--exact');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const threshold = thresholdArg ? parseInt(thresholdArg.split('=')[1], 10) : 10;
const cacheArg = args.find((a) => a.startsWith('--cache='));
const cachePath = cacheArg ? cacheArg.split('=')[1] : '.imgdupe-cache.json';
const dirs = args.filter((a) => !a.startsWith('--'));

if (dirs.length === 0) {
  console.error('Usage: npm run dev -- [--exact] [--threshold=N] [--cache=PATH] <folder> [folder2 ...]');
  console.error('  --exact          use SHA-256 (byte-identical only)');
  console.error('  --threshold=N    pHash Hamming distance cutoff (default: 10)');
  console.error('  --cache=PATH     cache file location (default: .imgdupe-cache.json)');
  process.exit(1);
}

const cache = new HashCache(cachePath);
await cache.load();

const groups: DuplicateGroup[] = exactMode
  ? await findDuplicates(dirs, cache)
  : await findSimilar(dirs, threshold, cache);

await cache.save();

const mode = exactMode ? 'exact (SHA-256)' : `perceptual (pHash, threshold=${threshold})`;

if (groups.length === 0) {
  console.log(`No duplicates found [${mode}].`);
} else {
  console.log(`Found ${groups.length} duplicate group(s) [${mode}]:\n`);
  for (const { hash, paths } of groups) {
    console.log(`  ${hash.slice(0, 16)}…`);
    for (const p of paths) console.log(`    ${p}`);
    console.log();
  }
}
