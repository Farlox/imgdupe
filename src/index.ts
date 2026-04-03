import { findDuplicates, findSimilar, type DuplicateGroup } from './scan.js';

const args = process.argv.slice(2);
const exactMode = args.includes('--exact');
const thresholdArg = args.find((a) => a.startsWith('--threshold='));
const threshold = thresholdArg ? parseInt(thresholdArg.split('=')[1], 10) : 10;
const dirs = args.filter((a) => !a.startsWith('--'));

if (dirs.length === 0) {
  console.error('Usage: npm run dev -- [--exact] [--threshold=N] <folder> [folder2 ...]');
  console.error('  --exact        use SHA-256 (byte-identical only)');
  console.error('  --threshold=N  pHash Hamming distance cutoff (default: 10)');
  process.exit(1);
}

const groups: DuplicateGroup[] = exactMode
  ? await findDuplicates(dirs)
  : await findSimilar(dirs, threshold);

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
