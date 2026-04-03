import { readFile, writeFile, stat } from 'node:fs/promises';

interface CacheEntry {
  mtime: number;
  size: number;
  sha256?: string;
  phash?: string;
}

type CacheData = Record<string, CacheEntry>;

export class HashCache {
  private data: CacheData = {};
  private dirty = false;
  private path: string;

  constructor(path = '.imgdupe-cache.json') {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf-8');
      this.data = JSON.parse(raw) as CacheData;
    } catch {
      this.data = {};
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await writeFile(this.path, JSON.stringify(this.data, null, 2));
  }

  /** Returns a validated entry for filePath, or null if stale/missing. */
  private async validate(filePath: string): Promise<CacheEntry | null> {
    const entry = this.data[filePath];
    if (!entry) return null;
    try {
      const s = await stat(filePath);
      if (s.mtimeMs !== entry.mtime || s.size !== entry.size) return null;
    } catch {
      return null;
    }
    return entry;
  }

  async getSha256(filePath: string): Promise<string | null> {
    return (await this.validate(filePath))?.sha256 ?? null;
  }

  async getPhash(filePath: string): Promise<string | null> {
    return (await this.validate(filePath))?.phash ?? null;
  }

  async set(filePath: string, values: { sha256?: string; phash?: string }): Promise<void> {
    let entry = await this.validate(filePath);
    if (!entry) {
      const s = await stat(filePath);
      entry = { mtime: s.mtimeMs, size: s.size };
    }
    if (values.sha256 !== undefined) entry.sha256 = values.sha256;
    if (values.phash !== undefined) entry.phash = values.phash;
    this.data[filePath] = entry;
    this.dirty = true;
  }
}
