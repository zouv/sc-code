'use strict';
// Shared Windows daily workflow. BAT files only select the action and preserve exits.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { root, runtime, runtimeConfig, run, assertPrepared } = require('./desktop-runtime.cjs');
const target = 'x86_64-pc-windows-msvc';
const { buildPaths } = require('./package-output.cjs');
const generated = ['.runtime/target', '.runtime/dist', '.runtime/public', '.runtime/metadata',
  '.runtime/desktop', '.runtime/package-staging', '.runtime/tauri.runtime.conf.json', '.runtime/logs', '.runtime/legacy', 'src-tauri/gen', 'packages'];
function cleanTargets(base = root) {
  const actualRoot = fs.realpathSync(base);
  return generated.map(relative => {
    const absolute = path.resolve(actualRoot, relative);
    if (!absolute.startsWith(actualRoot + path.sep)) throw new Error(`Unsafe cleanup path: ${absolute}`);
    let check = absolute;
    while (check !== actualRoot) {
      if (fs.existsSync(check) && fs.lstatSync(check).isSymbolicLink()) throw new Error(`Refusing link during cleanup: ${check}`);
      check = path.dirname(check);
    }
    return absolute;
  });
}
function clean(base = root, dry = false) {
  const targets = cleanTargets(base); // Validate ALL targets before deleting any.
  for (const file of targets) {
    console.log(`${dry ? '[DRY RUN]' : '[CLEAN]'} ${file}`);
    if (!dry) fs.rmSync(file, { recursive: true, force: true });
  }
}
function npmCli() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  if (process.platform === 'win32') {
    const found = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8' });
    for (const file of (found.stdout || '').trim().split(/\r?\n/)) candidates.push(path.join(path.dirname(file), 'node_modules/npm/bin/npm-cli.js'));
  }
  const cli = candidates.find(file => file && fs.existsSync(file) && file.endsWith('npm-cli.js'));
  if (!cli) throw new Error('npm CLI not found. Install Node.js 22+ with npm and add it to PATH.');
  return cli;
}
function npm(...args) { run(process.execPath, [npmCli(), ...args]); }
function dependencies() {
  if (!fs.existsSync(path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'))) npm('ci', '--ignore-scripts', '--no-audit', '--no-fund');
}
function prepare(force = false) {
  dependencies();
  let ready = false;
  if (!force) { try { assertPrepared(); ready = true; } catch (error) { console.log(`[PREPARE] ${error.message}`); } }
  if (!ready) run(process.execPath, [path.join(root, 'scripts/prepare-desktop-runtime.cjs')]);
}
function build(mode, bundleArgs, exportPackages = false) {
  prepare();
  run(process.execPath, [path.join(root, 'scripts/build-desktop.cjs'), ...(mode === 'Debug' ? ['--debug'] : []), '--target', target, ...(exportPackages ? ['--package'] : []), ...bundleArgs]);
  const marker = path.join(root, '.runtime/metadata', `desktop-${mode}.json`);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ fingerprint: sourceFingerprint() }) + '\n');
  console.log(`[OUTPUT] ${path.join(root, '.runtime/target', target, mode.toLowerCase())}`);
}
function sourceFingerprint() {
  const hash = crypto.createHash('sha256');
  const ignored = new Set(['node_modules', 'target', 'gen', '.git']);
  const inputs = ['src', 'src-tauri', 'public', 'crates', 'agent/server', 'scripts', '.cargo',
    'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'Cargo.toml', 'Cargo.lock', 'tsconfig.json', 'tsconfig.node.json', '.runtime/desktop/manifest.json'];
  function visit(file) {
    if (!fs.existsSync(file)) return;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Source link unsupported: ${file}`);
    if (fs.statSync(file).isDirectory()) {
      for (const entry of fs.readdirSync(file).sort()) if (!ignored.has(entry)) visit(path.join(file, entry));
    } else {
      hash.update(path.relative(root, file)); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0');
    }
  }
  for (const file of inputs) visit(path.join(root, file));
  return hash.digest('hex');
}
function launch(args) {
  prepare();
  const executable = path.join(root, '.runtime/target', target, 'debug/ScCode.exe');
  const marker = path.join(root, '.runtime/metadata/desktop-Debug.json');
  let current = false;
  try { current = fs.existsSync(executable) && JSON.parse(fs.readFileSync(marker, 'utf8')).fingerprint === sourceFingerprint(); } catch {}
  if (!current) build('Debug', ['--no-bundle']);
  run(executable, args); // foreground, no start/taskkill and no user profile override
}
function test() {
  dependencies();
  for (const script of ['test', 'test:transport', 'typecheck']) npm('run', script);
  const env = { ...process.env, AWS_LC_SYS_PREBUILT_NASM: '1' }; delete env.CC; delete env.CXX;
  run('cargo', ['test', '-p', 'sc-code-runtime', '-p', 'sc-code-auth', '-p', 'sc-code-workspace', '-p', 'sc-code-settings', '-p', 'sc-code-extensions'], { env });
  run('cargo', ['test', '-p', 'sc-code', '--lib'], { env });
}
function help() {
  console.log(`ScCode daily scripts (Node.js 22+, Rust MSVC, Go + C compiler for initial preparation)
  setup.bat               Install npm dependencies and prepare pinned desktop runtime
  run.bat [app args...]    Launch current Debug desktop; build if missing/stale
  dev.bat [tauri args...]  Desktop development with the prepared resource overlay
  build.bat [Debug|Release] [tauri args...]  Compile only (no packages)
  package.bat              Build Debug zip + Release setup/unpack/zip (local only)
  test.bat                Node, transport, TypeScript and selected native regressions
  verify.bat              test + import + runtime preflight + server smoke + docs
  clean.bat               Delete allowlisted generated output (incl. legacy packages/), not dist/ or profiles
  Any script --help / --dry-run: explain/preview without installing, building or launching.
Packages: dist/dev (Debug unpack dir + zip), dist/release (Release setup exe + unpack dir + zip).
Unpack dirs: dist/<mode>/unpack. Zip contents are rooted at the package root (no version subdirectory).
Intermediate output: .runtime/{desktop,target,dist,public,metadata,logs,package-staging}.
clean.bat preserves dist/, tools/downloads and user profiles; legacy packages/ is removed.
Known sc-code-agent timeout, sc-code-terminal Unix and sc-code-remote test failures are NOT part of test.bat.
No script commits, pushes, publishes, kills apps or deletes %APPDATA%/ScCode.`);
}
function main(action, args) {
  if (args.includes('--help') || args.includes('-h') || !action) return help();
  const dry = args.includes('--dry-run'); args = args.filter(a => a !== '--dry-run');
  if (!['setup', 'run', 'dev', 'build', 'release', 'package', 'test', 'verify', 'clean'].includes(action)) throw Object.assign(new Error(`Unknown action: ${action}`), { exitCode: 2 });
  const releaseAction = action === 'release' || action === 'package';
  let mode = releaseAction ? 'Release' : 'Debug';
  if (action === 'package' && args.length) {
    throw Object.assign(new Error(`package.bat builds Debug and Release together; arguments are not supported: ${args.join(' ')}`), { exitCode: 2 });
  }
  if (releaseAction && args.some(arg => arg === '--debug' || arg === '-d' || arg === '--no-bundle' || arg.startsWith('--profile'))) {
    throw Object.assign(new Error('package.bat always builds a Release installer; --debug, --profile and --no-bundle are not supported'), { exitCode: 2 });
  }
  if (action === 'build' && args[0] && !args[0].startsWith('-')) {
    const requested = args.shift();
    if (!/^(debug|release)$/i.test(requested)) throw Object.assign(new Error('Expected Debug or Release'), { exitCode: 2 });
    mode = /^release$/i.test(requested) ? 'Release' : 'Debug';
  }
  if (action === 'build' && args.some(arg => arg === '--bundles' || arg === '-b' || arg.startsWith('--bundles='))) {
    throw Object.assign(new Error('build.bat only compiles; use package.bat to build installers'), { exitCode: 2 });
  }
  if (action === 'build' && args.some(arg => arg.startsWith('--profile') || (mode === 'Release' && (arg === '--debug' || arg === '-d')))) {
    throw Object.assign(new Error('Use build.bat Debug or Release; overriding the selected profile is not supported'), { exitCode: 2 });
  }
  if (['setup', 'test', 'verify', 'clean'].includes(action) && args.length) throw Object.assign(new Error(`Unexpected ${action} arguments: ${args.join(' ')}`), { exitCode: 2 });
  if (action === 'clean') return clean(root, dry);
  if (dry) {
    const buildOutput = path.join(root, '.runtime/target', target, mode.toLowerCase());
    if (action === 'build') {
      console.log(`[DRY RUN] ScCode build ${mode}: ${args.join(' ')}\nRoot: ${root}\nRuntime: ${runtime}\nOverlay: ${runtimeConfig}\nBuild output: ${buildOutput}\nPackaging: skipped (use package.bat)\nNo files, applications or profiles changed.`);
      return;
    }
    if (action === 'package') {
      const dev = buildPaths(['--debug', '--target', target], root).dist;
      const release = buildPaths(['--target', target], root).dist;
      console.log(`[DRY RUN] ScCode package Debug+Release: \nRoot: ${root}\nRuntime: ${runtime}\nOverlay: ${runtimeConfig}\nPackage output (Debug): ${dev}\nPackage output (Release): ${release}\nNo files, applications or profiles changed.`);
      return;
    }
    console.log(`[DRY RUN] ScCode ${action} ${mode}: ${args.join(' ')}\nRoot: ${root}\nRuntime: ${runtime}\nOverlay: ${runtimeConfig}\nBuild output: ${buildOutput}\nPackage output: ${buildPaths([...(mode === 'Debug' ? ['--debug'] : []), '--target', target, ...args], root).dist}\nNo files, applications or profiles changed.`);
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ required.');
  switch (action) {
    case 'setup': npm('ci', '--ignore-scripts', '--no-audit', '--no-fund'); prepare(true); npm('run', 'setup'); break;
    case 'run': launch(args); break;
    case 'dev': prepare(); run(process.execPath, [path.join(root, 'scripts/dev-desktop.cjs'), ...args]); break;
    case 'build': {
      const compileArgs = args.includes('--no-bundle') ? args : ['--no-bundle', ...args];
      build(mode, compileArgs, false);
      break;
    }
    case 'release': {
      const releaseArgs = args.some(arg => arg === '--bundles' || arg === '-b' || arg.startsWith('--bundles=')) ? args : ['--bundles', 'nsis', ...args];
      build('Release', releaseArgs, true);
      break;
    }
    case 'package':
      build('Debug', ['--bundles', 'nsis'], true);
      build('Release', ['--bundles', 'nsis'], true);
      break;
    case 'test': test(); break;
    case 'verify': test(); npm('run', 'verify:import'); prepare(); npm('run', 'test:server');
      run('C:\\Program Files\\Git\\bin\\bash.exe', [path.join(root, 'check-docs.sh')]); break;
  }
}
module.exports = { cleanTargets, clean, main, sourceFingerprint };
if (require.main === module) {
  try { main(process.argv[2], process.argv.slice(3)); }
  catch (error) { console.error(`[ERROR] ${error.message}`); process.exitCode = error.exitCode || 1; }
}
