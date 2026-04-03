# CLAUDE.md — imgdupe

## Project Overview

**imgdupe** is a CLI tool (TypeScript/Node.js, ES Module) for detecting duplicate and visually similar images across one or more directories. It supports two detection strategies:

- **Exact mode (`--exact`):** SHA-256 byte-identical matching
- **Perceptual mode (default):** DCT-based perceptual hashing (pHash) with configurable Hamming distance threshold

## Repository Structure

```
imgdupe/
├── src/
│   ├── index.ts      # CLI entry point — argument parsing, orchestration
│   ├── scan.ts       # Core scanning logic: collectImagePaths, findDuplicates, findSimilar
│   ├── phash.ts      # DCT-based perceptual hash (phashFile, hammingDistance)
│   ├── hash.ts       # SHA-256 hashing via streams (hashFile)
│   ├── cache.ts      # HashCache class — persistent cache with mtime/size validation
│   ├── onedrive.ts   # Windows OneDrive cloud-only file detection via PowerShell
│   └── report.ts     # HTML report generator — CLI: npm run report
├── scripts/
│   └── full.ts       # Convenience pipeline: reads .mypaths, scans, generates report
├── tsconfig.json
└── package.json
```

## Key Commands

```bash
# Development (run directly with tsx)
npm run dev -- [options] <folder> [folder2 ...]

# Build TypeScript
npm run build          # outputs to dist/

# Run compiled build
npm start -- [options] <folder> [folder2 ...]

# Generate HTML report from a JSON scan result
npm run report -- --input=results.json --output=report.html

# Full pipeline (reads paths from .mypaths, outputs imgs.json + report)
npm run full
```

## CLI Options

| Option | Default | Description |
|---|---|---|
| `--exact` | off | Use SHA-256 byte-identical mode |
| `--threshold=N` | 10 | pHash Hamming distance cutoff (0–63) |
| `--cache=PATH` | `.imgdupe-cache.json` | Cache file location |
| `--output=PATH` | (none) | Write scan results as JSON |
| `--include-online` | off | Include OneDrive cloud-only files (Windows) |

## Supported Image Formats

`.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.tiff` `.tif` `.heic` `.heif` `.avif` (case-insensitive)

## Architecture & Key Conventions

### TypeScript Config
- **Target:** ES2022, **Module:** NodeNext, **Strict:** true
- Source files live in `src/`, compiled output goes to `dist/`
- Scripts in `scripts/` are run directly via `tsx` (not compiled)

### Module Style
- All files use ES Module syntax (`import`/`export`)
- Async/await throughout — no callbacks
- Promise-based file I/O via `fs/promises`

### Core Data Structures (in `src/scan.ts`)
```typescript
interface DuplicateGroup {
  hash: string;
  files: string[];
}

interface ScanResult {
  groups: DuplicateGroup[];     // groups with 2+ files
  total: number;                // total images scanned
  skipped: number;              // files that failed to hash
}
```

### Caching (`src/cache.ts`)
- `HashCache` class persists hashes to a JSON file
- Cache entries are validated by **mtime + size** — stale entries are recomputed
- Cache is flushed to disk every 30 seconds during long scans, and always on completion
- Default cache file: `.imgdupe-cache.json` (gitignored)

### Perceptual Hashing (`src/phash.ts`)
- Resize to 32×32 grayscale via Sharp
- Apply 2D DCT; take top-left 8×8 block (excluding DC coefficient) → 63-bit hash
- Hamming distance measures similarity (lower = more similar; 0 = identical)
- Default threshold of 10 is a reasonable starting point; lower = stricter

### Error Handling
- Files that fail to hash are skipped and counted in `skipped`
- Errors are logged to stderr; the scan continues
- OneDrive detection degrades gracefully on non-Windows systems

### HTML Report (`src/report.ts`)
- Standalone HTML file using `file://` URLs — no HTTP server required
- Lazy-loads thumbnail images for performance
- Includes folder-pair overlap analysis (which folders share the most duplicates)
- Accepts the JSON output from `--output` as input

## Development Notes

- **No test framework** is configured — manual testing only
- **No linter** is configured
- The `scripts/full.ts` pipeline reads folder paths from a `.mypaths` file (one path per line, gitignored)
- The `dist/` directory and `.imgdupe-cache.json` are gitignored

## Dependencies

| Package | Role |
|---|---|
| `sharp` | Image decoding, resizing, grayscale conversion, raw pixel access |
| `tsx` (dev) | Run `.ts` files directly without a compile step |
| `typescript` (dev) | TypeScript compiler |

## Branch Strategy

- `main` — stable branch
- Feature branches follow the pattern `claude/<description>-<id>`
