'use strict';
/**
 * Cold-start / idle-memory baseline for the desktop build.
 *
 * Usage:
 *   node scripts/perf-baseline.cjs [--exe <path>] [--seconds 30] [--out <dir>] [--keep]
 *
 * Measures:
 *   - time until the main window handle appears (proxy for "UI is up")
 *   - summed working set of the app process tree at 5s / 15s / end
 *
 * Results are written to .runtime/logs/perf-<timestamp>.json so runs can be
 * compared across changes. This does not touch user profiles; set
 * SC_CODE_HOME to an isolated directory before running. HOME and OS profile
 * environment variables are redirected there too; credential env vars are removed.
 * This measures a window handle, not workbench interactive readiness.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

if (!process.env.SC_CODE_HOME) {
	console.error('[perf] SC_CODE_HOME must point at an isolated test profile; refusing to measure the real profile.');
	process.exit(2);
}

function arg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const keep = process.argv.includes('--keep');
const seconds = Number(arg('seconds', '30'));
const exe = path.resolve(arg('exe', firstExisting([
	path.join(root, '.runtime/target/x86_64-pc-windows-msvc/release/ScCode.exe'),
	path.join(root, '.runtime/target/x86_64-pc-windows-msvc/debug/ScCode.exe'),
	path.join(root, '.runtime/target/release/ScCode.exe'),
	path.join(root, '.runtime/target/debug/ScCode.exe'),
])));
const outDir = path.resolve(arg('out', path.join(root, '.runtime/logs')));

function firstExisting(candidates) {
	return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function powershell(script) {
	const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
		encoding: 'utf8',
		windowsHide: true,
	});
	return (result.stdout || '').trim();
}

function processTreeMemory(rootPid) {
	const script = `
$root = ${rootPid}
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize
$ids = @($root); $changed = $true
while ($changed) {
  $changed = $false
  foreach ($p in $all) {
    if ($ids -contains $p.ParentProcessId -and -not ($ids -contains $p.ProcessId)) { $ids += $p.ProcessId; $changed = $true }
  }
}
$sum = 0; foreach ($p in $all) { if ($ids -contains $p.ProcessId) { $sum += $p.WorkingSetSize } }
Write-Output ("{0} {1}" -f $ids.Count, $sum)
`;
	const [count, bytes] = powershell(script).split(/\s+/);
	return { processes: Number(count) || 0, workingSetBytes: Number(bytes) || 0 };
}

function mainWindowHandle(pid) {
	const value = powershell(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle`);
	return Number(value) || 0;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
	if (process.platform !== 'win32') { throw new Error('This baseline requires Windows'); }
	if (!Number.isFinite(seconds) || seconds < 15 || seconds > 3600) { throw new Error('--seconds must be between 15 and 3600'); }
	if (fs.existsSync(path.join(root, '.env'))) { throw new Error('Refusing repository .env credentials'); }
	if (!fs.existsSync(exe)) {
		console.error(`[perf] executable not found: ${exe}`);
		process.exit(2);
	}
	fs.mkdirSync(outDir, { recursive: true });

	const profile = path.resolve(process.env.SC_CODE_HOME);
	fs.mkdirSync(profile, { recursive: true });
	const env = { SC_CODE_PERF_RUN: '1', SC_CODE_HOME: profile, HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
		TEMP: profile, TMP: profile, SC_CODE_LIVE_PRICING: '0', SC_CODE_TELEMETRY: '0' };
	for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT']) {
		const key = Object.keys(process.env).find(key => key.toLowerCase() === name.toLowerCase());
		if (key) { env[name] = process.env[key]; }
	}
	const startedAt = Date.now();
	const child = spawn(exe, [], { stdio: 'ignore', detached: false, env, cwd: root, windowsHide: true });
	let spawnError;
	child.on('error', error => { spawnError = error; });
	try {
		const samples = [];
		let windowAt = null;

		const deadline = startedAt + 60_000;
		while (Date.now() < deadline) {
			if (spawnError) { throw spawnError; }
			if (child.exitCode !== null) { throw new Error(`App exited before readiness: ${child.exitCode}`); }
			if (mainWindowHandle(child.pid)) {
				windowAt = Date.now() - startedAt;
				break;
			}
			await sleep(100);
		}
		if (windowAt === null) {
			throw new Error('Main window did not appear within 60s; no successful baseline will be written');
		}

		const sampleAt = async label => {
			if (child.exitCode !== null) { throw new Error(`App exited during sampling: ${child.exitCode}`); }
			const memory = processTreeMemory(child.pid);
			if (memory.workingSetBytes <= 0) { throw new Error('Process-tree memory unavailable'); }
			samples.push({ label, atMs: Date.now() - startedAt, ...memory });
		};
		await sleep(Math.max(0, 5_000 - (Date.now() - startedAt)));
		await sampleAt('5s');
		await sleep(Math.max(0, 15_000 - (Date.now() - startedAt)));
		await sampleAt('15s');
		await sleep(Math.max(0, seconds * 1000 - (Date.now() - startedAt)));
		await sampleAt(`${seconds}s`);

		const report = {
			timestamp: new Date().toISOString(),
			exe,
			windowReadyMs: windowAt,
			samples,
			notes: 'Window-handle readiness only (not interactive workbench). workingSetBytes sums the process tree (Rust + WebView2 + Node/Go children); debug and release results are not interchangeable.',
		};
		const outFile = path.join(outDir, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
		fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
		console.log(JSON.stringify(report, null, 2));
		console.log(`[perf] written to ${outFile}`);

	} finally {
		if (!keep && child.exitCode === null && child.pid) {
			spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
		}
	}
}

main().catch(error => {
	console.error('[perf] failed:', error);
	process.exit(1);
});
