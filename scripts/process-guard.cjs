'use strict';
// Guard for running ScCode instances that live inside this repository (Windows).
// dev force-closes them and continues; package lists them and only closes after Y.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;

function readAppIdentity() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const packageSection = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? '';
  const binSection = /\[\[bin\]\]([\s\S]*?)(?:\n\[|$)/.exec(cargo)?.[1] ?? '';
  const names = [
    config.productName,
    /^\s*name\s*=\s*"([^"]+)"/m.exec(binSection)?.[1],
    /^\s*name\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1],
  ]
    .filter(Boolean)
    .map((name) => `${name.replace(/\.exe$/i, '')}.exe`.toLowerCase());
  if (names.length === 0) throw new Error('Cannot determine the ScCode executable name');
  return { label: config.productName || 'ScCode', names: [...new Set(names)] };
}

const psQuote = (value) => `'${value.replaceAll("'", "''")}'`;

function findAppProcesses(identity) {
  if (process.platform !== 'win32') return [];
  const script = [
    `$names = @(${identity.names.map(psQuote).join(',')})`,
    `$root = ${psQuote(rootPrefix)}`,
    '$result = Get-CimInstance Win32_Process | Where-Object {',
    '  if (-not $_.Name -or -not $_.ExecutablePath) { return $false }',
    '  if (-not ($names -contains $_.Name.ToLowerInvariant())) { return $false }',
    '  $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)',
    '} | ForEach-Object {',
    '  [pscustomobject]@{ ProcessId = $_.ProcessId; Name = $_.Name; ExecutablePath = $_.ExecutablePath }',
    '}',
    'if ($result) { $result | ConvertTo-Json -Compress }',
  ].join('\n');
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function closeProcesses(identity, processes) {
  for (const item of processes) {
    try {
      execFileSync('taskkill', ['/PID', String(item.ProcessId), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The process may have exited already; the re-check below reports the result.
    }
  }
  sleep(800);
  const remaining = findAppProcesses(identity);
  if (remaining.length > 0) {
    const details = remaining.map((item) => `${item.Name}(${item.ProcessId})`).join(', ');
    throw new Error(`Could not close the running app (${details}); close it manually and retry.`);
  }
  console.log('[ ok ] Closed the running app instance(s); continuing.');
}

function list(identity, processes) {
  console.warn(`[warn] ${identity.label} is running from this repository:`);
  for (const item of processes) {
    console.warn(`       PID ${String(item.ProcessId).padEnd(6)} ${item.Name}  ${item.ExecutablePath}`);
  }
  console.warn('[warn] Force-closing discards any unsaved state in the running app.');
  console.warn('       Only processes whose executable is inside this repository are touched.');
}

function guardForDev() {
  const identity = readAppIdentity();
  const processes = findAppProcesses(identity);
  if (processes.length === 0) return;
  list(identity, processes);
  closeProcesses(identity, processes);
}

function confirmViaPowerShell(message) {
  const script = [
    `$answer = Read-Host ${psQuote(message)}`,
    "if ($answer -match '^\\s*[Yy]([Ee][Ss])?\\s*$') { exit 0 } else { exit 2 }",
  ].join('; ');
  const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function guardForPackage() {
  if (process.platform !== 'win32') return true;
  const identity = readAppIdentity();
  const processes = findAppProcesses(identity);
  if (processes.length === 0) return true;
  list(identity, processes);
  if (process.env.SC_CODE_FORCE_CLOSE !== '1') {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      throw new Error(
        'Non-interactive input cannot confirm closing it. Close the app first, or set SC_CODE_FORCE_CLOSE=1.',
      );
    }
    if (!confirmViaPowerShell(`Force-close ${identity.label} and continue packaging? Enter Y to confirm; anything else cancels`)) {
      console.log('[info] Packaging cancelled; the running app was left alone.');
      return false;
    }
  }
  closeProcesses(identity, processes);
  return true;
}

module.exports = { findAppProcesses, guardForDev, guardForPackage };
