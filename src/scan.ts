import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { hashFile } from './hash.js';
import { phashFile, hammingDistance } from './phash.js';
import { HashCache } from './cache.js';

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

export type DuplicateGroup = { hash: string; paths: string[] };

export async function findDuplicates(dirs: string[], cache: HashCache): Promise<DuplicateGroup[]> {
  const allPaths = (await Promise.all(dirs.map(collectImagePaths))).flat();

  const hashMap = new Map<string, string[]>();
  await Promise.all(allPaths.map(async (filePath) => {
    const hash = await cachedSha256(filePath, cache);
    const group = hashMap.get(hash);
    if (group) {
      group.push(filePath);
    } else {
      hashMap.set(hash, [filePath]);
    }
  }));

  const duplicates: DuplicateGroup[] = [];
  for (const [hash, paths] of hashMap) {
    if (paths.length > 1) duplicates.push({ hash, paths });
  }
  return duplicates;
}

/**
 * Find visually similar images using perceptual hashing.
 * Images whose pHash Hamming distance is <= threshold are grouped together.
 * threshold=0 means identical-looking, ~10 is a reasonable "similar" cutoff.
 */
export async function findSimilar(dirs: string[], threshold = 10, cache: HashCache): Promise<DuplicateGroup[]> {
  const allPaths = (await Promise.all(dirs.map(collectImagePaths))).flat();

  const entries = await Promise.all(
    allPaths.map(async (path) => ({ path, hash: await cachedPhash(path, cache) }))
  );

  // O(n²) grouping — fine for typical photo library sizes
  const grouped = new Set<number>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < entries.length; i++) {
    if (grouped.has(i)) continue;
    const members: string[] = [entries[i].path];
    for (let j = i + 1; j < entries.length; j++) {
      if (grouped.has(j)) continue;
      if (hammingDistance(entries[i].hash, entries[j].hash) <= threshold) {
        members.push(entries[j].path);
        grouped.add(j);
      }
    }
    if (members.length > 1) {
      grouped.add(i);
      groups.push({ hash: entries[i].hash.toString(16).padStart(16, '0'), paths: members });
    }
  }

  return groups;
}
