import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { hashFile } from './hash.js';
import { phashFile, hammingDistance } from './phash.js';
import { HashCache } from './cache.js';
import { filterOnlineOnlyFiles } from './onedrive.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.heic', '.heif', '.avif']);

async function collectImagePaths(dir: string): Promise<string[]> {
  const paths: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await collectImagePaths(fullPath));
    } else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      paths.push(fullPath);
    }
  }));

  return paths;
}

async function cachedSha256(filePath: string, cache: HashCache): Promise<string> {
  const hit = await cache.getSha256(filePath);
  if (hit) return hit;
  const sha256 = await hashFile(filePath);
  await cache.set(filePath, { sha256 });
  return sha256;
}

async function cachedPhash(filePath: string, cache: HashCache): Promise<bigint> {
  const hit = await cache.getPhash(filePath);
  if (hit) return BigInt('0x' + hit);
  const hash = await phashFile(filePath);
  await cache.set(filePath, { phash: hash.toString(16).padStart(16, '0') });
  return hash;
}

export type DuplicateGroup = { hash: string; paths: string[]; sizes: number[] };
export type ScanResult = { totalScanned: number; groups: DuplicateGroup[] };

async function withConcurrency<T>(limit: number, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}

export async function findDuplicates(dirs: string[], cache: HashCache, skipOnline = true): Promise<ScanResult> {
  const allPaths = await filterOnlineOnlyFiles(
    (await Promise.all(dirs.map(collectImagePaths))).flat(),
    skipOnline,
  );

  const hashMap = new Map<string, { paths: string[]; sizes: number[] }>();
  const total = allPaths.length;
  let completed = 0;
  const startTime = Date.now();

  console.log(`${total.toLocaleString()} paths found, beginning scan...`);
  console.log();

  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    const eta = completed > 0
      ? ` — ETA ${formatEta(Math.round((elapsed / completed) * (total - completed)))}`
      : '';
    process.stderr.write(`  hashing: ${completed}/${total} (${pct}%)${eta}\n`);
    cache.save().catch(console.error);
  }, 10_000);

  await withConcurrency(64, allPaths, async (filePath) => {
    try {
      const [hash, { size }] = await Promise.all([cachedSha256(filePath, cache), stat(filePath)]);
      completed++;
      const group = hashMap.get(hash);
      if (group) {
        group.paths.push(filePath);
        group.sizes.push(size);
      } else {
        hashMap.set(hash, { paths: [filePath], sizes: [size] });
      }
    } catch (err) {
      completed++;
      console.warn(`  skipping ${filePath}: ${(err as Error).message}`);
    }
  });

  clearInterval(progressInterval);
  const groups: DuplicateGroup[] = [];
  for (const [hash, { paths, sizes }] of hashMap) {
    if (paths.length > 1) groups.push({ hash, paths, sizes });
  }
  return { totalScanned: allPaths.length, groups };
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Find visually similar images using perceptual hashing.
 * Images whose pHash Hamming distance is <= threshold are grouped together.
 * threshold=0 means identical-looking, ~10 is a reasonable "similar" cutoff.
 */
export async function findSimilar(dirs: string[], threshold = 10, cache: HashCache, skipOnline = true): Promise<ScanResult> {
  const allPaths = await filterOnlineOnlyFiles(
    (await Promise.all(dirs.map(collectImagePaths))).flat(),
    skipOnline,
  );
  const total = allPaths.length;
  let completed = 0;
  const startTime = Date.now();

  console.log(
    `${allPaths.length.toLocaleString()} paths found, beginning scan...`,
  );
  console.log();

  const progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const pct = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';
    const eta = completed > 0
      ? ` — ETA ${formatEta(Math.round((elapsed / completed) * (total - completed)))}`
      : '';
    process.stderr.write(`  hashing: ${completed}/${total} (${pct}%)${eta}\n`);
    cache.save().catch(console.error);
  }, 10_000);

  const settled: ({ path: string; hash: bigint; size: number } | null)[] = new Array(allPaths.length).fill(null);
  await withConcurrency(64, allPaths.map((path, i) => ({ path, i })), async ({ path, i }) => {
    try {
      const [hash, { size }] = await Promise.all([cachedPhash(path, cache), stat(path)]);
      completed++;
      settled[i] = { path, hash, size };
    } catch (err) {
      completed++;
      console.warn(`  skipping ${path}: ${(err as Error).message}`);
    }
  });
  clearInterval(progressInterval);

  const entries = settled.filter((e) => e !== null);

  // O(n²) grouping — fine for typical photo library sizes
  const grouped = new Set<number>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (grouped.has(i)) continue;
    const members: string[] = [entries[i].path];
    const sizes: number[] = [entries[i].size];
    for (let j = i + 1; j < entries.length; j++) {
      if (grouped.has(j)) continue;
      if (hammingDistance(entries[i].hash, entries[j].hash) <= threshold) {
        members.push(entries[j].path);
        sizes.push(entries[j].size);
        grouped.add(j);
      }
    }
    if (members.length > 1) {
      grouped.add(i);
      groups.push({ hash: entries[i].hash.toString(16).padStart(16, '0'), paths: members, sizes });
    }
  }

  return { totalScanned: allPaths.length, groups };
}
