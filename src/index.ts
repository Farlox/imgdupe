import { hashFile } from './hash.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: npm run dev -- <file-path>');
  process.exit(1);
}

const hash = await hashFile(filePath);
console.log(`${hash}  ${filePath}`);
