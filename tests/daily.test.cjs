'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { clean, cleanTargets, main } = require('../scripts/daily.cjs');
const { root, runtime, runtimeConfig } = require('../scripts/desktop-runtime.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('generated assets and frontend builds live inside .runtime, source scripts stay source', () => {
  assert.equal(runtime, path.join(root, '.runtime/desktop'));
  assert.equal(runtimeConfig, path.join(root, '.runtime/tauri.runtime.conf.json'));
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).build.frontendDist, '../.runtime/dist');
  assert.match(read('.cargo/config.toml'), /target-dir = ".runtime\/target"/);
  assert.match(read('vite.config.ts'), /publicDir: '.runtime\/public'/);
  assert.match(read('vite.config.ts'), /outDir: '.runtime\/dist'/);
  assert.match(read('scripts/generate-extension-meta.js'), /.runtime\/desktop\/extensions/);
  assert.doesNotMatch(read('src-tauri/build.rs'), /Path::new\("shell-integration"\)/);
  assert.ok(fs.existsSync(path.join(root, 'src/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1')));
});
test('Agent stays collapsed at startup even when old layout says visible', () => {
  const layout = read('src/vs/workbench/browser/layout.ts');
  assert.match(layout, /SIDEX_HIDDEN: new RuntimeStateKey<boolean>\([\s\S]{0,200}true/);
  assert.match(layout, /this.stateCache.set\(LayoutStateKeys.SIDEX_HIDDEN.name, true\)/);
  assert.match(layout, /setSidexHidden\(/); // User can still open it manually.
});
test('cleanup dry run and actual cleanup preserve dependencies, downloads, tools and user-like source', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-daily-clean-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const folder of ['.runtime/tools', '.runtime/downloads', '.runtime/target', '.runtime/desktop', 'node_modules', 'src', 'ScCode']) {
    fs.mkdirSync(path.join(base, folder), { recursive: true }); fs.writeFileSync(path.join(base, folder, 'keep'), 'x');
  }
  clean(base, true); assert.ok(fs.existsSync(path.join(base, '.runtime/target/keep')));
  clean(base);
  assert.ok(!fs.existsSync(path.join(base, '.runtime/target')));
  for (const folder of ['.runtime/tools', '.runtime/downloads', 'node_modules', 'src', 'ScCode']) assert.ok(fs.existsSync(path.join(base, folder, 'keep')));
});
test('cleanup rejects junction ancestors before deleting anything', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-daily-link-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-daily-outside-'));
  t.after(() => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(base, '.runtime')); fs.writeFileSync(path.join(outside, 'keep'), 'x');
  fs.symlinkSync(outside, path.join(base, '.runtime/target'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => cleanTargets(base), /Refusing link/); assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'x');
});
test('BAT wrappers use their own directory, stay foreground and preserve exit codes', () => {
  for (const action of ['setup', 'run', 'dev', 'build', 'release', 'test', 'verify', 'clean']) {
    const text = read(action + '.bat');
    assert.match(text, /pushd "%~dp0"/); assert.match(text, /set "CODE=%ERRORLEVEL%"/);
    assert.match(text, /exit \/b %CODE%/); assert.doesNotMatch(text, /taskkill|start\s+"|rmdir|del\s+\//i);
    assert.match(text, new RegExp(`node "scripts\\\\daily.cjs" ${action} %\\*`));
  }
});
test('BAT works from another cwd and invalid arguments keep nonzero status', { skip: process.platform !== 'win32' }, () => {
  const cmd = process.env.ComSpec || 'cmd.exe';
  // Raw cmd command quoting matches cmd /s /c's outer quote stripping rules.
  const invoke = (name, arg) => spawnSync(cmd, ['/d', '/s', '/c', `""${path.join(root, name)}" ${arg}"`], { cwd: os.tmpdir(), encoding: 'utf8', windowsVerbatimArguments: true });
  const help = invoke('run.bat', '--help'); assert.equal(help.status, 0, help.stderr + help.stdout); assert.match(help.stdout, /ScCode daily scripts/);
  const dry = invoke('clean.bat', '--dry-run'); assert.equal(dry.status, 0, dry.stderr + dry.stdout); assert.match(dry.stdout, /DRY RUN/);
  const invalid = invoke('build.bat', 'Nonsense'); assert.equal(invalid.status, 2, invalid.stderr + invalid.stdout);
  const release = invoke('release.bat', '--dry-run'); assert.equal(release.status, 0, release.stderr + release.stdout); assert.match(release.stdout, /ScCode release Release/); assert.match(release.stdout, /packages[\\/]release/); assert.match(release.stdout, /Unpack output: .*packages[\\/]unpack[\\/]release/);
  const debug = invoke('release.bat', '--debug --dry-run'); assert.equal(debug.status, 2, debug.stderr + debug.stdout);
  const shortDebug = invoke('release.bat', '-d --dry-run'); assert.equal(shortDebug.status, 2, shortDebug.stderr + shortDebug.stdout);
  const dev = invoke('build.bat', 'Debug --dry-run'); assert.equal(dev.status, 0, dev.stderr + dev.stdout); assert.match(dev.stdout, /packages[\\/]dev/); assert.match(dev.stdout, /Unpack output: .*packages[\\/]unpack[\\/]dev/);
  const conflict = invoke('build.bat', 'Release --debug --dry-run'); assert.equal(conflict.status, 2, conflict.stderr + conflict.stdout);
});
test('old profile migration precedes SideX and stable credentials are persisted after migration', () => {
  const dirs = read('src-tauri/src/app_dirs.rs');
  assert.ok(dirs.indexOf('sources.push(parent.join("Sc-Code"))') < dirs.indexOf('sources.push(parent.join("SideX"))'));
  assert.match(read('src-tauri/src/commands/secrets.rs'), /sc-code.extension-secret-profile-id.v1/);
  const lib = read('src-tauri/src/lib.rs'); assert.ok(lib.indexOf('resolve_and_migrate()') < lib.indexOf('commands::secrets::initialize'));
});
