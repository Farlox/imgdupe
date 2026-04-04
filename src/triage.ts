import { basename, dirname } from 'node:path';
import { type ScanOutput } from './report.js';

// --- Exported API types ---

export interface TriageAction {
  action: 'delete' | 'move';
  path: string;
  toFolder?: string; // absolute; only for 'move'
}

export interface TriageApplyRequest {
  actions: TriageAction[];
  dryRun?: boolean;
}

export interface TriageActionResult {
  path: string;
  ok: boolean;
  dryRun?: boolean;
  destination?: string; // resolved destination for 'move' actions
  error?: string;
}

// --- HTML renderer ---

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderTriageHtml(
  data: ScanOutput,
  file: string,
  toUrl: (absPath: string) => string,
): string {
  const sorted = [...data.groups].sort((a, b) => b.paths.length - a.paths.length);

  // Build per-group data for the embedded JS: paths, sizes, unique folders
  const groupsData = sorted.map((g) => ({
    paths: g.paths,
    sizes: g.sizes ?? [],
    folders: [...new Set(g.paths.map((p) => dirname(p)))],
  }));

  // Server-side group shells (JS will fill content)
  const groupShells = sorted.map((g, i) => {
    const hash = escapeHtml(g.hash);
    return `<div class="triage-group" data-idx="${i}">
  <div class="group-header">
    <span class="group-num">Group ${i + 1}</span>
    <span class="group-count">${g.paths.length} files</span>
    <code class="group-hash">${hash}</code>
    <span class="group-status" id="gstatus-${i}"></span>
  </div>
  <div class="group-body" id="gbody-${i}"></div>
</div>`;
  }).join('\n');

  const modeLabel = data.mode === 'exact'
    ? 'Exact (SHA-256)'
    : `Perceptual pHash — threshold ${data.threshold}`;

  // Pre-compute URL mappings for all image paths so JS can reference them
  const urlMap: Record<string, string> = {};
  for (const g of sorted) {
    for (const p of g.paths) {
      urlMap[p] = toUrl(p);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>imgdupe triage — ${escapeHtml(file)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: system-ui, sans-serif;
    background: #f4f4f5;
    color: #18181b;
    padding-top: 4rem; /* room for sticky header */
  }

  /* Sticky header */
  .triage-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #fff;
    border-bottom: 1px solid #e4e4e7;
    padding: .6rem 1.5rem;
    display: flex;
    align-items: center;
    gap: 1.2rem;
    box-shadow: 0 1px 4px rgba(0,0,0,.06);
  }
  .triage-bar h1 { font-size: 1rem; font-weight: 700; white-space: nowrap; }
  .triage-bar .meta { font-size: 0.78rem; color: #71717a; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .triage-bar .progress { font-size: 0.82rem; color: #3f3f46; white-space: nowrap; }
  .btn-apply {
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: .45rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background .15s;
  }
  .btn-apply:hover:not(:disabled) { background: #4f46e5; }
  .btn-apply:disabled { background: #a5b4fc; cursor: not-allowed; }

  .page-body { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }

  /* Group cards */
  .triage-group {
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 10px;
    margin-bottom: 1.25rem;
    overflow: hidden;
  }
  .triage-group.group-done { opacity: .55; }
  .triage-group.group-done .group-header { background: #f4f4f5; }

  .group-header {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .6rem 1rem;
    background: #fafafa;
    border-bottom: 1px solid #e4e4e7;
    font-size: 0.82rem;
  }
  .group-num { font-weight: 700; }
  .group-count { color: #71717a; }
  .group-hash { margin-left: auto; font-size: 0.72rem; color: #6366f1; background: #eef2ff; padding: 2px 7px; border-radius: 4px; }
  .group-status { font-size: 0.72rem; color: #71717a; }

  .group-body {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 1rem;
  }

  /* Image cards */
  .img-card {
    display: flex;
    flex-direction: column;
    width: 220px;
    border: 2px solid transparent;
    border-radius: 8px;
    overflow: hidden;
    background: #fafafa;
    transition: border-color .15s, opacity .15s;
  }
  .img-card.card-keep { border-color: #16a34a; }
  .img-card.card-delete { border-color: #dc2626; opacity: .8; }
  .img-card.card-ignore { border-color: #d4d4d8; }

  .img-card a { display: block; }
  .img-card img {
    width: 216px;
    height: 180px;
    object-fit: cover;
    background: #f4f4f5;
    display: block;
  }
  .card-info {
    padding: .45rem .5rem .3rem;
    font-size: 0.72rem;
    color: #52525b;
    word-break: break-all;
  }
  .card-filename { font-weight: 600; color: #18181b; }
  .card-size { color: #71717a; margin-top: 1px; }
  .card-size.largest { color: #16a34a; font-weight: 600; }

  /* Action buttons */
  .card-actions {
    display: flex;
    gap: .3rem;
    padding: .35rem .5rem .4rem;
  }
  .act-btn {
    flex: 1;
    border: 1px solid #e4e4e7;
    border-radius: 5px;
    padding: .25rem 0;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    background: #fff;
    color: #52525b;
    transition: background .1s, color .1s, border-color .1s;
  }
  .act-btn:hover { background: #f4f4f5; }
  .act-btn.active-keep { background: #dcfce7; color: #16a34a; border-color: #86efac; }
  .act-btn.active-delete { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }
  .act-btn.active-ignore { background: #f4f4f5; color: #71717a; border-color: #d4d4d8; }

  /* Move-to pills */
  .move-section {
    padding: .2rem .5rem .45rem;
    font-size: 0.72rem;
    color: #3f3f46;
    border-top: 1px solid #f4f4f5;
  }
  .move-label { margin-bottom: .3rem; color: #71717a; }
  .move-pills { display: flex; flex-wrap: wrap; gap: .3rem; }
  .move-pill {
    border: 1px solid #c7d2fe;
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 0.7rem;
    cursor: pointer;
    background: #fff;
    color: #4f46e5;
    word-break: break-all;
    transition: background .1s;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .move-pill:hover { background: #eef2ff; }
  .move-pill.active { background: #6366f1; color: #fff; border-color: #6366f1; }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.45);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .modal-backdrop[hidden] { display: none; }
  .modal-box {
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 540px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: .75rem;
    box-shadow: 0 8px 32px rgba(0,0,0,.18);
  }
  .modal-box h2 { font-size: 1rem; font-weight: 700; }
  .modal-section-title { font-size: 0.78rem; font-weight: 700; color: #3f3f46; margin-bottom: .3rem; }
  .modal-scroll { overflow-y: auto; max-height: 280px; }
  .modal-list {
    list-style: none;
    font-size: 0.75rem;
    color: #52525b;
    display: flex;
    flex-direction: column;
    gap: .2rem;
  }
  .modal-list li { word-break: break-all; }
  .modal-list li.item-delete { color: #dc2626; }
  .modal-list li.item-move { color: #1d4ed8; }
  .delete-count { font-weight: 700; color: #dc2626; }
  .modal-buttons {
    display: flex;
    gap: .5rem;
    justify-content: flex-end;
    flex-shrink: 0;
  }
  .btn-cancel {
    background: #f4f4f5; border: 1px solid #e4e4e7;
    border-radius: 6px; padding: .4rem .9rem;
    font-size: 0.85rem; cursor: pointer;
  }
  .btn-cancel:hover { background: #e4e4e7; }
  .btn-dryrun {
    background: #fff; border: 1px solid #6366f1; color: #6366f1;
    border-radius: 6px; padding: .4rem .9rem;
    font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  .btn-dryrun:hover { background: #eef2ff; }
  .btn-confirm {
    background: #dc2626; color: #fff; border: none;
    border-radius: 6px; padding: .4rem .9rem;
    font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  .btn-confirm:hover { background: #b91c1c; }
  .btn-confirm:disabled { background: #fca5a5; cursor: not-allowed; }
  .btn-done {
    background: #16a34a; color: #fff; border: none;
    border-radius: 6px; padding: .4rem .9rem;
    font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }

  /* Result list in modal */
  .result-ok { color: #16a34a; }
  .result-err { color: #dc2626; }
  .result-dry { color: #6366f1; }
</style>
</head>
<body>

<div class="triage-bar">
  <h1>imgdupe triage</h1>
  <span class="meta">${escapeHtml(file)} &mdash; ${escapeHtml(modeLabel)} &mdash; ${data.totalScanned} images, ${sorted.length} groups</span>
  <span class="progress" id="progress">0 / ${sorted.length} triaged</span>
  <button class="btn-apply" id="btn-apply" disabled onclick="openModal()">Apply Triage</button>
</div>

<div class="page-body">
${groupShells}
</div>

<div class="modal-backdrop" id="modal" hidden>
  <div class="modal-box" id="modal-box">
    <!-- filled by JS -->
  </div>
</div>

<script>
const GROUPS = ${JSON.stringify(groupsData)};
const URL_MAP = ${JSON.stringify(urlMap)};

// --- State ---
const state = {
  groups: GROUPS.map(g => ({
    fileActions: initFileActions(g),
    keeperMoveToFolder: null,
  })),
};

function initFileActions(g) {
  const sizes = g.sizes ?? [];
  const allEqual = sizes.length === 0 || new Set(sizes).size === 1;
  const keepIdx = allEqual ? 0 : sizes.indexOf(Math.max(...sizes));
  return g.paths.map((_, i) => i === keepIdx ? 'keep' : 'delete');
}

// --- State mutations ---
function setAction(gIdx, fIdx, action) {
  const gs = state.groups[gIdx];
  const current = gs.fileActions[fIdx];

  if (action === 'keep') {
    if (current === 'keep') {
      // Toggle off: reset all to ignore
      gs.fileActions = gs.fileActions.map(() => 'ignore');
      gs.keeperMoveToFolder = null;
    } else {
      // Demote old keeper to delete, set new keeper
      gs.fileActions = gs.fileActions.map((a, i) => {
        if (i === fIdx) return 'keep';
        if (a === 'keep') return 'delete';
        return a;
      });
    }
  } else {
    gs.fileActions[fIdx] = action;
  }

  renderGroup(gIdx);
  renderProgress();
}

function setMoveFolder(gIdx, folder) {
  const gs = state.groups[gIdx];
  gs.keeperMoveToFolder = gs.keeperMoveToFolder === folder ? null : folder;
  renderGroup(gIdx);
}

// --- Rendering ---
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function renderGroup(gIdx) {
  const g = GROUPS[gIdx];
  const gs = state.groups[gIdx];
  const sizes = g.sizes ?? [];
  const maxSize = sizes.length > 0 ? Math.max(...sizes) : null;
  const allSizesEqual = maxSize === null || new Set(sizes).size <= 1;

  const keeperIdx = gs.fileActions.indexOf('keep');

  let html = '';
  g.paths.forEach((p, fIdx) => {
    const action = gs.fileActions[fIdx];
    const size = sizes[fIdx] ?? null;
    const isLargest = !allSizesEqual && size === maxSize;
    const imgUrl = URL_MAP[p] ?? '';
    const fname = p.split('/').pop() ?? p;
    const folder = g.folders ? g.folders[g.folders.indexOf(g.folders.find(f => p.startsWith(f)) ?? '')] : '';

    html += \`<div class="img-card card-\${action}">
  <a href="\${esc(imgUrl)}" target="_blank">
    <img src="\${esc(imgUrl)}" alt="\${esc(fname)}" loading="lazy" />
  </a>
  <div class="card-info">
    <div class="card-filename" title="\${esc(p)}">\${esc(fname)}</div>
    \${size !== null ? \`<div class="card-size\${isLargest ? ' largest' : ''}">\${fmtBytes(size)}</div>\` : ''}
  </div>
  <div class="card-actions">
    <button class="act-btn\${action === 'keep' ? ' active-keep' : ''}" onclick="setAction(\${gIdx},\${fIdx},'keep')">Keep</button>
    <button class="act-btn\${action === 'delete' ? ' active-delete' : ''}" onclick="setAction(\${gIdx},\${fIdx},'delete')">Delete</button>
    <button class="act-btn\${action === 'ignore' ? ' active-ignore' : ''}" onclick="setAction(\${gIdx},\${fIdx},'ignore')">Ignore</button>
  </div>
  \${action === 'keep' ? renderMovePills(gIdx, fIdx, g, gs) : ''}
</div>\`;
  });

  document.getElementById('gbody-' + gIdx).innerHTML = html;

  // Update group status badge
  const st = document.getElementById('gstatus-' + gIdx);
  if (keeperIdx >= 0) {
    const deleteCount = gs.fileActions.filter(a => a === 'delete').length;
    const parts = [];
    if (gs.keeperMoveToFolder) parts.push('move');
    if (deleteCount) parts.push('delete ' + deleteCount);
    st.textContent = parts.length ? '· ' + parts.join(', ') : '· keep in place';
    st.style.color = '#16a34a';
  } else {
    st.textContent = '· skipped';
    st.style.color = '#71717a';
  }

  // Done styling
  const groupEl = document.querySelector('.triage-group[data-idx="' + gIdx + '"]');
  groupEl.classList.toggle('group-done', false);
}

function renderMovePills(gIdx, keeperFIdx, g, gs) {
  // Show folders from other files in the group (excluding the keeper's own folder)
  const keeperFolder = g.paths[keeperFIdx] ? g.paths[keeperFIdx].split('/').slice(0, -1).join('/') : '';
  const otherFolders = [...new Set(
    g.paths
      .map((p, i) => i !== keeperFIdx ? p.split('/').slice(0, -1).join('/') : null)
      .filter(Boolean)
  )].filter(f => f !== keeperFolder);

  if (otherFolders.length === 0) return '';

  const active = gs.keeperMoveToFolder;
  const pills = otherFolders.map(f => {
    const isActive = active === f;
    const label = f.length > 40 ? '…' + f.slice(-37) : f;
    return \`<button class="move-pill\${isActive ? ' active' : ''}" title="\${esc(f)}" onclick="setMoveFolder(\${gIdx}, '\${escJs(f)}')">\${esc(label)}</button>\`;
  }).join('');

  const destLabel = active
    ? \`Move to: \${active.length > 50 ? '…' + active.slice(-47) : active}\`
    : 'Move to folder:';

  return \`<div class="move-section">
  <div class="move-label">\${esc(destLabel)}</div>
  <div class="move-pills">\${pills}</div>
</div>\`;
}

function renderProgress() {
  const triaged = state.groups.filter(gs => gs.fileActions.includes('keep')).length;
  document.getElementById('progress').textContent = triaged + ' / ' + GROUPS.length + ' triaged';
  document.getElementById('btn-apply').disabled = triaged === 0;
}

// --- Build action list ---
function buildActions() {
  const actions = [];
  state.groups.forEach((gs, gIdx) => {
    const keepIdx = gs.fileActions.indexOf('keep');
    if (keepIdx < 0) return;
    const keepPath = GROUPS[gIdx].paths[keepIdx];
    const keepFolder = keepPath.split('/').slice(0, -1).join('/');

    if (gs.keeperMoveToFolder && gs.keeperMoveToFolder !== keepFolder) {
      actions.push({ action: 'move', path: keepPath, toFolder: gs.keeperMoveToFolder });
    }
    gs.fileActions.forEach((a, fIdx) => {
      if (a === 'delete') {
        actions.push({ action: 'delete', path: GROUPS[gIdx].paths[fIdx] });
      }
    });
  });
  return actions;
}

// --- Modal ---
function openModal() {
  const actions = buildActions();
  const moves = actions.filter(a => a.action === 'move');
  const deletes = actions.filter(a => a.action === 'delete');

  if (actions.length === 0) {
    alert('Nothing to apply. Select at least one file to keep.');
    return;
  }

  let html = '<h2>Review triage actions</h2><div class="modal-scroll"><ul class="modal-list">';

  if (moves.length > 0) {
    html += \`<li class="modal-section-title">Moves (\${moves.length})</li>\`;
    moves.forEach(a => {
      const fname = a.path.split('/').pop();
      html += \`<li class="item-move">↗ \${esc(fname)} → \${esc(a.toFolder)}</li>\`;
    });
  }

  if (deletes.length > 0) {
    html += \`<li class="modal-section-title" style="margin-top:.5rem"><span class="delete-count">\${deletes.length} file\${deletes.length === 1 ? '' : 's'} will be permanently deleted</span></li>\`;
    deletes.forEach(a => {
      html += \`<li class="item-delete">✕ \${esc(a.path)}</li>\`;
    });
  }

  html += \`</ul></div>
<div class="modal-buttons">
  <button class="btn-cancel" onclick="closeModal()">Cancel</button>
  <button class="btn-dryrun" onclick="runApply(true)">Dry Run</button>
  <button class="btn-confirm" id="btn-confirm" onclick="runApply(false)">Confirm (delete \${deletes.length})</button>
</div>\`;

  showModal(html);
}

function closeModal() {
  document.getElementById('modal').hidden = true;
}

function showModal(html) {
  document.getElementById('modal-box').innerHTML = html;
  document.getElementById('modal').hidden = false;
}

async function runApply(dryRun) {
  const actions = buildActions();
  const btn = document.getElementById('btn-confirm');
  if (btn) btn.disabled = true;

  showModal('<h2>' + (dryRun ? 'Dry run preview' : 'Applying…') + '</h2><p style="font-size:.85rem;color:#71717a">Working…</p>');

  let resp, data;
  try {
    resp = await fetch('/api/triage/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions, dryRun }),
    });
    data = await resp.json();
  } catch (err) {
    showModal('<h2>Error</h2><p style="color:#dc2626">' + esc(String(err)) + '</p><div class="modal-buttons"><button class="btn-cancel" onclick="closeModal()">Close</button></div>');
    return;
  }

  const results = data.results ?? [];
  let html = '<h2>' + (dryRun ? 'Dry run preview' : 'Results') + '</h2><div class="modal-scroll"><ul class="modal-list">';

  results.forEach((r) => {
    if (!resp.ok || !r.ok) {
      html += \`<li class="result-err">✕ \${esc(r.path)}\${r.error ? ' — ' + esc(r.error) : ''}</li>\`;
    } else if (dryRun) {
      const matchingAction = actions.find(a => a.path === r.path);
      if (matchingAction?.action === 'move') {
        html += \`<li class="result-dry">↗ would move \${esc(r.path.split('/').pop())} → \${esc(r.destination ?? matchingAction.toFolder ?? '')}</li>\`;
      } else {
        html += \`<li class="result-dry">✕ would delete \${esc(r.path)}</li>\`;
      }
    } else {
      const matchingAction = actions.find(a => a.path === r.path);
      if (matchingAction?.action === 'move') {
        html += \`<li class="result-ok">✓ moved \${esc(r.path.split('/').pop())} → \${esc(r.destination ?? '')}</li>\`;
      } else {
        html += \`<li class="result-ok">✓ deleted \${esc(r.path)}</li>\`;
      }
    }
  });

  html += '</ul></div><div class="modal-buttons">';
  if (dryRun) {
    html += '<button class="btn-cancel" onclick="openModal()">← Back</button>';
  } else {
    html += '<button class="btn-done" onclick="closeModal(); markDoneGroups()">Done</button>';
  }
  html += '</div>';
  showModal(html);
}

function markDoneGroups() {
  state.groups.forEach((gs, gIdx) => {
    if (gs.fileActions.includes('keep')) {
      const groupEl = document.querySelector('.triage-group[data-idx="' + gIdx + '"]');
      if (groupEl) groupEl.classList.add('group-done');
    }
  });
}

// --- Escape helpers ---
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJs(s) {
  return String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  GROUPS.forEach((_, i) => renderGroup(i));
  renderProgress();
});
</script>
</body>
</html>`;
}
