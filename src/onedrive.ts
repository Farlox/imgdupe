import { spawn } from 'node:child_process';

// FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS (0x400000):
// Set on OneDrive cloud-only placeholder files on Windows.
// Opening such a file triggers a network download.
const RECALL_ON_DATA_ACCESS = 0x400000;

async function getOnlineOnlyPaths(paths: string[]): Promise<Set<string>> {
  return new Promise((resolve) => {
    // Pipe newline-separated paths into a PowerShell process.
    // The script checks each path's attributes and outputs only
    // those with the RECALL_ON_DATA_ACCESS bit set.
    const script = [
      `$RECALL = ${RECALL_ON_DATA_ACCESS}`,
      '$input | ForEach-Object {',
      '  $p = $_.Trim()',
      '  if ($p) {',
      '    try {',
      '      $attrs = [int][IO.File]::GetAttributes($p)',
      '      if ($attrs -band $RECALL) { Write-Output $p }',
      '    } catch {}',
      '  }',
      '}',
    ].join('\n');

    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    ps.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

    ps.on('close', () => {
      const online = new Set(
        stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      );
      resolve(online);
    });

    // On error (e.g. PowerShell not available), don't filter anything
    ps.on('error', () => resolve(new Set()));

    ps.stdin.write(paths.join('\n'));
    ps.stdin.end();
  });
}

/**
 * On Windows, returns `paths` with OneDrive cloud-only placeholders removed.
 * On other platforms, or when `skipOnline` is false, returns `paths` unchanged.
 */
export async function filterOnlineOnlyFiles(paths: string[], skipOnline: boolean): Promise<string[]> {
  if (!skipOnline || process.platform !== 'win32' || paths.length === 0) {
    return paths;
  }

  const onlineOnly = await getOnlineOnlyPaths(paths);
  if (onlineOnly.size === 0) return paths;

  console.warn(`  skipping ${onlineOnly.size} OneDrive online-only file(s) (use --include-online to force download)`);
  return paths.filter((p) => !onlineOnly.has(p));
}
