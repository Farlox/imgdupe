import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface DuplicateGroup {
  hash: string;
  paths: string[];
}

interface ScanOutput {
  generatedAt: string;
  mode: 'exact' | 'perceptual';
  threshold?: number;
  scannedFolders: string[];
  totalScanned: number;
  totalDuplicateGroups: number;
  totalDuplicateFiles: number;
  groups: DuplicateGroup[];
}

function fileUrl(absPath: string): string {
  return 'file://' + absPath;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderGroup(group: DuplicateGroup, index: number): string {
  const images = group.paths.map((p) => `
    <figure class="img-card">
      <a href="${escapeHtml(fileUrl(p))}" target="_blank">
        <img src="${escapeHtml(fileUrl(p))}" alt="${escapeHtml(basename(p))}" loading="lazy" />
      </a>
      <figcaption title="${escapeHtml(p)}">${escapeHtml(p)}</figcaption>
    </figure>`).join('');

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

function renderHtml(data: ScanOutput): string {
  const modeLabel = data.mode === 'exact'
    ? 'Exact (SHA-256)'
    : `Perceptual pHash — threshold ${data.threshold}`;

  const sorted = [...data.groups].sort((a, b) => b.paths.length - a.paths.length);
  const groups = sorted.map((g, i) => renderGroup(g, i)).join('');

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

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: #71717a;
    font-size: 1.1rem;
  }
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
    : groups}

</body>
</html>`;
}

// --- CLI ---

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

const html = renderHtml(data);
await writeFile(outputPath, html);
console.log(`Report written to ${outputPath}`);
