import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { renderHtml, buildFolderFileCounts, type ScanOutput } from './report.js';

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const dirArg = args.find((a) => a.startsWith('--dir='));
const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
const scanDir = dirArg ? resolve(dirArg.split('=')[1]) : process.cwd();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resolveFile(file: string): string {
  return isAbsolute(file) ? file : resolve(scanDir, file);
}

async function readScanOutput(filePath: string): Promise<ScanOutput> {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw) as ScanOutput;
}

async function serveIndex(res: ServerResponse): Promise<void> {
  const entries = await readdir(scanDir);
  const jsonFiles = entries.filter((e) => e.endsWith('.json'));

  const rows = await Promise.all(jsonFiles.map(async (name) => {
    try {
      const s = await stat(resolve(scanDir, name));
      const modified = s.mtime.toLocaleString();
      return `<tr><td><a href="/?file=${encodeURIComponent(name)}">${escapeHtml(name)}</a></td><td>${escapeHtml(modified)}</td></tr>`;
    } catch {
      return `<tr><td><a href="/?file=${encodeURIComponent(name)}">${escapeHtml(name)}</a></td><td>—</td></tr>`;
    }
  }));

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>imgdupe</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #f4f4f5; color: #18181b; padding: 2rem; }
  h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 1.5rem; }
  .card { background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; padding: 1.5rem 2rem; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; color: #71717a; padding: .5rem .75rem; border-bottom: 1px solid #e4e4e7; }
  td { padding: .5rem .75rem; border-bottom: 1px solid #f4f4f5; font-size: 0.875rem; }
  tr:last-child td { border-bottom: none; }
  a { color: #6366f1; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .dir { font-size: 0.78rem; color: #71717a; margin-bottom: 1rem; font-family: monospace; }
  .empty { color: #71717a; padding: 2rem 0; text-align: center; }
</style>
</head>
<body>
<h1>imgdupe</h1>
<p class="dir">${escapeHtml(scanDir)}</p>
<div class="card">
${rows.length > 0
    ? `<table><thead><tr><th>File</th><th>Modified</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="empty">No JSON files found in this directory.</p>'}
</div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function serveReport(file: string, res: ServerResponse): Promise<void> {
  const filePath = resolveFile(file);
  const data = await readScanOutput(filePath);
  const folderFileCounts = await buildFolderFileCounts(data.groups);
  const html = renderHtml(data, folderFileCounts);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function serveResult(file: string, res: ServerResponse): Promise<void> {
  const filePath = resolveFile(file);
  const raw = await readFile(filePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(raw);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const pathname = url.pathname;
  const file = url.searchParams.get('file');

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/') {
    if (file) {
      await serveReport(file, res);
    } else {
      await serveIndex(res);
    }
  } else if (pathname === '/api/result') {
    if (!file) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing ?file= parameter');
      return;
    }
    await serveResult(file, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err: Error) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    res.end(`Error: ${err.message}`);
  });
});

server.listen(port, () => {
  console.log(`imgdupe server running at http://localhost:${port}`);
  console.log(`Serving JSON files from: ${scanDir}`);
});
