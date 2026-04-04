import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, stat, rename, unlink, access } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { renderHtml, buildFolderFileCounts, type ScanOutput } from './report.js';
import { renderTriageHtml, type TriageApplyRequest, type TriageActionResult } from './triage.js';

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

function isReport(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return typeof o['generatedAt'] === 'string' && typeof o['mode'] === 'string';
}

async function serveIndex(res: ServerResponse): Promise<void> {
  const entries = await readdir(scanDir);
  const jsonFiles = entries.filter((e) => e.endsWith('.json'));

  const rows = (await Promise.all(jsonFiles.map(async (name) => {
    try {
      const filePath = resolve(scanDir, name);
      const [raw, s] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)]);
      const parsed = JSON.parse(raw);
      if (!isReport(parsed)) return null;
      const modified = s.mtime.toLocaleString();
      return `<tr><td><a href="/?file=${encodeURIComponent(name)}">${escapeHtml(name)}</a></td><td>${escapeHtml(modified)}</td><td><a href="/triage?file=${encodeURIComponent(name)}">Triage</a></td></tr>`;
    } catch {
      return null;
    }
  }))).filter((r): r is string => r !== null);

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
    ? `<table><thead><tr><th>File</th><th>Modified</th><th>Actions</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="empty">No imgdupe reports found in this directory.</p>'}
</div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
};

async function serveImage(imgPath: string, res: ServerResponse): Promise<void> {
  if (!isAbsolute(imgPath)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }
  const ext = imgPath.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = IMAGE_MIME[ext];
  if (!mimeType) {
    res.writeHead(415, { 'Content-Type': 'text/plain' });
    res.end('Unsupported Media Type');
    return;
  }
  const data = await readFile(imgPath);
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(data);
}

function toHttpUrl(absPath: string): string {
  return `/img?path=${encodeURIComponent(absPath)}`;
}

async function serveReport(file: string, res: ServerResponse): Promise<void> {
  const filePath = resolveFile(file);
  const data = await readScanOutput(filePath);
  const folderFileCounts = await buildFolderFileCounts(data.groups);
  const html = renderHtml(data, folderFileCounts, toHttpUrl);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function openFolder(filePath: string, res: ServerResponse): void {
  if (!isAbsolute(filePath)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request: path must be absolute');
    return;
  }
  const [cmd, args, opts] = process.platform === 'win32'
    ? [`explorer.exe /select,"${filePath}"`, [], { shell: true, detached: true, stdio: 'ignore' }] as const
    : process.platform === 'darwin'
    ? ['open', ['-R', filePath], { shell: false, detached: true, stdio: 'ignore' }] as const
    : ['xdg-open', [dirname(filePath)], { shell: false, detached: true, stdio: 'ignore' }] as const;
  console.log('[openFolder] cmd=%s args=%o', cmd, args);
  const child = spawn(cmd, args, opts);
  child.on('close', (code) => console.log('[openFolder] exited code=%d', code));
  child.unref();
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}

async function serveResult(file: string, res: ServerResponse): Promise<void> {
  const filePath = resolveFile(file);
  const raw = await readFile(filePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(raw);
}

async function serveTriage(file: string | null, res: ServerResponse): Promise<void> {
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing ?file= parameter');
    return;
  }
  const filePath = resolveFile(file);
  const data = await readScanOutput(filePath);
  const html = renderTriageHtml(data, file, toHttpUrl);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_048_576) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function resolveDestination(srcPath: string, toFolder: string): Promise<string> {
  const name = basename(srcPath);
  const candidate = join(toFolder, name);
  try {
    await access(candidate);
    // File exists — append timestamp suffix before extension
    const dotIdx = name.lastIndexOf('.');
    const stem = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
    const ext = dotIdx >= 0 ? name.slice(dotIdx) : '';
    return join(toFolder, `${stem}_moved_${Date.now()}${ext}`);
  } catch {
    return candidate;
  }
}

async function applyTriage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: TriageApplyRequest;
  try {
    body = await readJsonBody(req) as TriageApplyRequest;
  } catch (err) {
    const e = err as { statusCode?: number; message: string };
    res.writeHead(e.statusCode ?? 400, { 'Content-Type': 'text/plain' });
    res.end(e.message);
    return;
  }

  const actions = body.actions ?? [];
  const dryRun = body.dryRun ?? false;

  // Validate all paths are absolute
  for (const action of actions) {
    if (!isAbsolute(action.path)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Non-absolute path: ${action.path}` }));
      return;
    }
    if (action.toFolder !== undefined && !isAbsolute(action.toFolder)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Non-absolute toFolder: ${action.toFolder}` }));
      return;
    }
  }

  const results: TriageActionResult[] = await Promise.all(actions.map(async (action): Promise<TriageActionResult> => {
    try {
      if (action.action === 'delete') {
        if (!dryRun) await unlink(action.path);
        return { path: action.path, ok: true, dryRun };
      } else {
        const dest = await resolveDestination(action.path, action.toFolder!);
        if (!dryRun) await rename(action.path, dest);
        return { path: action.path, ok: true, dryRun, destination: dest };
      }
    } catch (err) {
      return { path: action.path, ok: false, error: (err as Error).message };
    }
  }));

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ results, dryRun }));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const pathname = url.pathname;
  const file = url.searchParams.get('file');
  const method = req.method ?? 'GET';

  // POST routes
  if (method === 'POST') {
    if (pathname === '/api/triage/apply') {
      await applyTriage(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
    return;
  }

  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, POST' });
    res.end('Method Not Allowed');
    return;
  }

  if (pathname === '/') {
    if (file) {
      await serveReport(file, res);
    } else {
      await serveIndex(res);
    }
  } else if (pathname === '/triage') {
    await serveTriage(file, res);
  } else if (pathname === '/img') {
    const imgPath = url.searchParams.get('path') ?? '';
    await serveImage(imgPath, res);
  } else if (pathname === '/api/open-folder') {
    const folderPath = url.searchParams.get('path') ?? '';
    openFolder(folderPath, res);
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
