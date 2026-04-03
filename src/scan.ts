import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { hashFile } from './hash.js';

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

export type DuplicateGroup = { hash: string; paths: string[] };

export async function findDuplicates(dirs: string[]): Promise<DuplicateGroup[]> {
  const allPaths = (await Promise.all(dirs.map(collectImagePaths))).flat();

  const hashMap = new Map<string, string[]>();
  await Promise.all(allPaths.map(async (filePath) => {
    const hash = await hashFile(filePath);
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
