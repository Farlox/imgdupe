import { findDuplicates } from './scan.js';

const dirs = process.argv.slice(2);

if (dirs.length === 0) {
  console.error('Usage: npm run dev -- <folder> [folder2 ...]');
  process.exit(1);
}

const groups = await findDuplicates(dirs);

if (groups.length === 0) {
  console.log('No duplicates found.');
} else {
  console.log(`Found ${groups.length} duplicate group(s):\n`);
  for (const { hash, paths } of groups) {
    console.log(`  ${hash.slice(0, 12)}…`);
    for (const p of paths) console.log(`    ${p}`);
    console.log();
  }
}
