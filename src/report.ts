import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

export interface DuplicateGroup {
  hash: string;
  paths: string[];
  sizes?: number[];
}

export interface ScanOutput {
  generatedAt: string;
  mode: 'exact' | 'perceptual';
  threshold?: number;
  scannedFolders: string[];
  totalScanned: number;
  totalDuplicateGroups: number;
  totalDuplicateFiles: number;
  groups: DuplicateGroup[];
}

interface FolderPair {
  a: string;
  b: string;
  sharedGroups: number;
  aDupeFiles: number;
  bDupeFiles: number;
  aTotalFiles: number | null;
  bTotalFiles: number | null;
}

function analyzeFolderPairs(groups: DuplicateGroup[], folderFileCounts: Map<string, number>): FolderPair[] {
  const pairCounts = new Map<string, number>();
  const folderDupeFiles = new Map<string, number>();

  for (const group of groups) {
    const folders = [...new Set(group.paths.map((p) => dirname(p)))];
    for (const folder of folders) {
      const inFolder = group.paths.filter((p) => dirname(p) === folder).length;
      folderDupeFiles.set(folder, (folderDupeFiles.get(folder) ?? 0) + inFolder);
    }
    for (let i = 0; i < folders.length; i++) {
      for (let j = i + 1; j < folders.length; j++) {
        const key = [folders[i], folders[j]].sort().join('\0');
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return [...pairCounts.entries()]
    .map(([key, sharedGroups]) => {
      const [a, b] = key.split('\0');
      return {
        a, b, sharedGroups,
        aDupeFiles: folderDupeFiles.get(a) ?? 0,
        bDupeFiles: folderDupeFiles.get(b) ?? 0,
        aTotalFiles: folderFileCounts.get(a) ?? null,
        bTotalFiles: folderFileCounts.get(b) ?? null,
      };
    })
    .sort((x, y) => y.sharedGroups - x.sharedGroups);
}

function fmt(dupes: number, total: number | null): string {
  if (total === null) return String(dupes);
  return `${dupes} / ${total} (${Math.round(dupes / total * 100)}%)`;
}

function renderFolderAnalysis(pairs: FolderPair[]): string {
  if (pairs.length === 0) return '';

  const renderRows = (ps: FolderPair[]) => ps.map((p) => `
    <tr>
      <td>${escapeHtml(p.a)}</td>
      <td class="pair-count">${fmt(p.aDupeFiles, p.aTotalFiles)}</td>
      <td>${escapeHtml(p.b)}</td>
      <td class="pair-count">${fmt(p.bDupeFiles, p.bTotalFiles)}</td>
      <td class="pair-count">${p.sharedGroups}</td>
    </tr>`).join('');

  const top = pairs.slice(0, 10);
  const rest = pairs.slice(10);

  const more = rest.length > 0 ? `
    <details class="folder-more">
      <summary>${rest.length} more…</summary>
      <table>
        <tbody>${renderRows(rest)}</tbody>
      </table>
    </details>` : '';

  return `
  <section class="folder-analysis">
    <h2>Folder overlap</h2>
    <p class="folder-analysis-desc">Folder pairs that share the most duplicate groups — likely copies of each other.</p>
    <table>
      <thead><tr><th>Folder A</th><th>Dupes</th><th>Folder B</th><th>Dupes</th><th>Shared groups</th></tr></thead>
      <tbody>${renderRows(top)}</tbody>
    </table>${more}
  </section>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderGroup(group: DuplicateGroup, index: number, toUrl: (absPath: string) => string): string {
  const sizes = group.sizes;
  const sizesVary = sizes != null && new Set(sizes).size > 1;
  const maxSize = sizesVary ? Math.max(...sizes!) : null;

  const images = group.paths.map((p, i) => {
    const size = sizes?.[i];
    const sizeTag = sizesVary && size != null
      ? `<span class="file-size${size === maxSize ? ' file-size-largest' : ''}">${fmtBytes(size)}</span>`
      : '';
    const folder = dirname(p);
    const url = escapeHtml(toUrl(p));
    return `
    <figure class="img-card">
      <a href="${url}" target="_blank">
        <img src="${url}" alt="${escapeHtml(basename(p))}" loading="lazy" />
      </a>
      <figcaption title="${escapeHtml(p)}">${escapeHtml(p)}${sizeTag}
        <button class="copy-btn" data-path="${escapeHtml(folder)}" title="Copy folder path">📋</button>
      </figcaption>
    </figure>`;
  }).join('');

  return `
  <section class="group">
    <header class="group-header">
      <span class="group-num">Group ${index + 1}</span>
      <span class="group-count">${group.paths.length} files</span>
      <code class="group-hash">${escapeHtml(group.hash)}</code>
    </header>
    <div class="img-row">${images}</div>
  </section>`;
}

export function renderHtml(
  data: ScanOutput,
  folderFileCounts: Map<string, number>,
  toUrl: (absPath: string) => string = (p) => 'file://' + p,
): string {
  const modeLabel = data.mode === 'exact'
    ? 'Exact (SHA-256)'
    : `Perceptual pHash — threshold ${data.threshold}`;

  const sorted = [...data.groups].sort((a, b) => b.paths.length - a.paths.length);
  const groups = sorted.map((g, i) => renderGroup(g, i, toUrl)).join('');
  const folderAnalysis = renderFolderAnalysis(analyzeFolderPairs(data.groups, folderFileCounts));

  const folderList = data.scannedFolders
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>imgdupe report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: system-ui, sans-serif;
    background: #f4f4f5;
    color: #18181b;
    padding: 2rem;
  }

  h1 { font-size: 1.6rem; font-weight: 700; }

  .summary {
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    padding: 1.5rem 2rem;
    margin-bottom: 2rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem 2rem;
  }
  .summary h1 { grid-column: 1 / -1; margin-bottom: 0.5rem; }
  .summary dl { display: contents; }
  .summary dt { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; color: #71717a; }
  .summary dd { font-weight: 600; font-size: 1rem; }
  .summary .folders { grid-column: 1 / -1; }
  .summary .folders ul { margin-top: .25rem; list-style: none; font-size: 0.85rem; color: #3f3f46; }

  .stat-row {
    grid-column: 1 / -1;
    display: flex;
    gap: 2rem;
    margin-top: 0.5rem;
  }
  .stat { display: flex; flex-direction: column; }

  .group {
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: .75rem 1.25rem;
    background: #fafafa;
    border-bottom: 1px solid #e4e4e7;
    font-size: 0.875rem;
  }
  .group-num { font-weight: 700; }
  .group-count { color: #71717a; }
  .group-hash { margin-left: auto; font-size: 0.78rem; color: #6366f1; background: #eef2ff; padding: 2px 8px; border-radius: 4px; }

  .img-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 1.25rem;
  }

  .img-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 220px;
  }
  .img-card a { display: block; }
  .img-card img {
    width: 200px;
    height: 200px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid #e4e4e7;
    background: #f4f4f5;
    transition: opacity .15s;
  }
  .img-card img:hover { opacity: .85; }
  .img-card figcaption {
    margin-top: .5rem;
    font-size: 0.72rem;
    color: #52525b;
    word-break: break-all;
    text-align: center;
    max-width: 200px;
  }
  .file-size {
    display: block;
    margin-top: .2rem;
    font-size: 0.72rem;
    color: #71717a;
  }
  .file-size-largest {
    color: #16a34a;
    font-weight: 600;
  }
  .copy-btn {
    display: inline-block;
    margin-top: .2rem;
    background: none;
    border: 1px solid #e4e4e7;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.7rem;
    cursor: pointer;
    line-height: 1.4;
    color: #52525b;
  }
  .copy-btn:hover { background: #f4f4f5; }
  .copy-btn.copied { color: #16a34a; border-color: #16a34a; }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: #71717a;
    font-size: 1.1rem;
  }

  .folder-analysis {
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    padding: 1.5rem 2rem;
    margin-bottom: 2rem;
  }
  .folder-analysis h2 { font-size: 1rem; font-weight: 700; margin-bottom: .25rem; }
  .folder-analysis-desc { font-size: 0.82rem; color: #71717a; margin-bottom: 1rem; }
  .folder-analysis table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .folder-analysis th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .05em; color: #71717a; padding: .4rem .75rem; border-bottom: 1px solid #e4e4e7; }
  .folder-analysis td { padding: .4rem .75rem; border-bottom: 1px solid #f4f4f5; word-break: break-all; }
  .folder-analysis tr:last-child td { border-bottom: none; }
  .pair-count { text-align: right; font-weight: 600; white-space: nowrap; }
  .folder-more { margin-top: .5rem; }
  .folder-more summary { font-size: 0.82rem; color: #6366f1; cursor: pointer; padding: .25rem 0; }
  .folder-more table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: .5rem; }
  .folder-more td { padding: .4rem .75rem; border-bottom: 1px solid #f4f4f5; word-break: break-all; }
  .folder-more tr:last-child td { border-bottom: none; }
</style>
</head>
<body>

<div class="summary">
  <h1>imgdupe report</h1>

  <dl>
    <dt>Generated</dt>
    <dd>${escapeHtml(new Date(data.generatedAt).toLocaleString())}</dd>
    <dt>Mode</dt>
    <dd>${escapeHtml(modeLabel)}</dd>
  </dl>

  <div class="stat-row">
    <div class="stat"><dt>Images scanned</dt><dd>${data.totalScanned}</dd></div>
    <div class="stat"><dt>Duplicate groups</dt><dd>${data.totalDuplicateGroups}</dd></div>
    <div class="stat"><dt>Duplicate files</dt><dd>${data.totalDuplicateFiles}</dd></div>
  </div>

  <div class="folders">
    <dt>Folders</dt>
    <ul>${folderList}</ul>
  </div>
</div>

${data.groups.length === 0
    ? '<p class="empty">No duplicates found.</p>'
    : folderAnalysis + groups}

<script>
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.path).then(() => {
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '📋'; btn.classList.remove('copied'); }, 1500);
    });
  });
</script>
</body>
</html>`;
}

// --- Shared helper ---

export async function buildFolderFileCounts(groups: DuplicateGroup[]): Promise<Map<string, number>> {
  const allFolders = [...new Set(groups.flatMap((g) => g.paths.map((p) => dirname(p))))];
  const folderFileCounts = new Map<string, number>();
  await Promise.all(allFolders.map(async (folder) => {
    try {
      const entries = await readdir(folder);
      folderFileCounts.set(folder, entries.length);
    } catch {
      // folder unreadable — leave absent so UI shows raw dupe count only
    }
  }));
  return folderFileCounts;
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args.find((a) => a.startsWith('--input='));
  const outputArg = args.find((a) => a.startsWith('--output='));

  if (!inputArg || !outputArg) {
    console.error('Usage: npm run report -- --input=results.json --output=report.html');
    process.exit(1);
  }

  const inputPath = inputArg.split('=')[1];
  const outputPath = outputArg.split('=')[1];

  const raw = await readFile(inputPath, 'utf-8');
  const data = JSON.parse(raw) as ScanOutput;
  const folderFileCounts = await buildFolderFileCounts(data.groups);
  const html = renderHtml(data, folderFileCounts);
  await writeFile(outputPath, html);
  console.log(`Report written to ${outputPath}`);
}

if (process.argv[1]?.includes('report')) main();
