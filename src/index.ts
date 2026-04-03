import { writeFile } from 'node:fs/promises';
import { findDuplicates, findSimilar } from './scan.js';
import { HashCache } from './cache.js';

const args = process.argv.slice(2);
const exactMode = args.includes('--exact');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const threshold = thresholdArg ? parseInt(thresholdArg.split('=')[1], 10) : 10;
const cacheArg = args.find((a) => a.startsWith('--cache='));
const cachePath = cacheArg ? cacheArg.split('=')[1] : '.imgdupe-cache.json';
const outputArg = args.find((a) => a.startsWith('--output='));
const outputPath = outputArg ? outputArg.split('=')[1] : null;
const dirs = args.filter((a) => !a.startsWith('--'));

if (dirs.length === 0) {
  console.error('Usage: npm run dev -- [options] <folder> [folder2 ...]');
  console.error('  --exact           use SHA-256 (byte-identical only)');
  console.error('  --threshold=N     pHash Hamming distance cutoff (default: 10)');
  console.error('  --cache=PATH      cache file location (default: .imgdupe-cache.json)');
  console.error('  --output=PATH     write results as JSON to this file');
  process.exit(1);
}

const cache = new HashCache(cachePath);
await cache.load();

const { totalScanned, groups } = exactMode
  ? await findDuplicates(dirs, cache)
  : await findSimilar(dirs, threshold, cache);

await cache.save();

const mode = exactMode ? 'exact' : 'perceptual';
const modeLabel = exactMode ? 'exact (SHA-256)' : `perceptual (pHash, threshold=${threshold})`;

if (outputPath) {
  const output = {
    generatedAt: new Date().toISOString(),
    mode,
    ...(exactMode ? {} : { threshold }),
    scannedFolders: dirs,
    totalScanned,
    totalDuplicateGroups: groups.length,
    totalDuplicateFiles: groups.reduce((n, g) => n + g.paths.length, 0),
    groups,
  };
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`Results written to ${outputPath}`);
}

if (groups.length === 0) {
  console.log(`No duplicates found [${modeLabel}].`);
} else {
  console.log(`Found ${groups.length} duplicate group(s) of ${totalScanned} images scanned [${modeLabel}]:\n`);
  for (const { hash, paths } of groups) {
    console.log(`  ${hash.slice(0, 16)}…`);
    for (const p of paths) console.log(`    ${p}`);
    console.log();
  }
}
