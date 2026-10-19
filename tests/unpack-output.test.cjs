'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildPaths } = require('../scripts/package-output.cjs');
const { exportUnpack, archiveUnpack, validateUnpack, requiredFiles, resourceDirs, removeStage } = require('../scripts/unpack-output.cjs');
const { buildDesktop } = require('../scripts/build-desktop.cjs');
const { clean } = require('../scripts/daily.cjs');
const { sha256 } = require('../scripts/desktop-runtime.cjs');
const { write, runtimeFixture } = require('./unpack-fixture.cjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc unpack 中文-'));
  t.after(() => {
    const resolved = fs.realpathSync(base);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('sc unpack 中文-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ version: '0.1.1' }));
  return base;
}
test('unpack resources match both Tauri resource configurations', () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  for (const destination of Object.values(config.bundle.resources)) assert.ok(destination.endsWith('/') ? resourceDirs.includes(destination.slice(0, -1)) : requiredFiles.includes(destination), destination);
  const preparation = fs.readFileSync(path.join(root, 'scripts/prepare-desktop-runtime.cjs'), 'utf8');
  for (const name of ['bin', 'extension-host', 'extensions', 'licenses']) assert.ok(preparation.includes("'" + name + "/':'" + name + "/'"));
  assert.ok(preparation.includes("'sidex-server.exe':'sidex-server.exe'"));
  assert.ok(preparation.includes("'manifest.json':'runtime-manifest.json'"));
});
test('complete unpack is movable and includes runtime/licenses/DLLs but excludes build cache', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths);
  for (const file of ['ScCode.pdb', 'ScCode.d', 'deps/cache', 'bundle/nsis/installer.exe', 'build/cache', '.cargo-lock']) write(path.join(paths.build, file), 'do not ship');
  write(path.join(paths.build, 'WebView2Loader.dll'), 'optional app-local DLL');
  assert.equal(exportUnpack(base, paths), path.join(base, 'packages/unpack/release'));
  for (const relative of requiredFiles) assert.equal(sha256(path.join(paths.unpack, relative)), sha256(path.join(paths.build, relative)));
  assert.ok(fs.existsSync(path.join(paths.unpack, 'WebView2Loader.dll')));
  assert.ok(fs.existsSync(path.join(paths.unpack, 'licenses/ScCode-LICENSE.txt')));
  for (const file of ['ScCode.pdb', 'ScCode.d', 'deps', 'bundle', 'build', '.cargo-lock']) assert.equal(fs.existsSync(path.join(paths.unpack, file)), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.unpack, 'unpack-manifest.json')));
  for (const file of manifest.files) assert.equal(sha256(path.join(paths.unpack, file.path)), file.sha256);
  const elsewhere = path.join(base, 'moved folder 中文');
  fs.renameSync(paths.unpack, elsewhere);
  clean(base);
  assert.equal(validateUnpack(base, elsewhere).builtinCount, 3);
  assert.match(fs.readFileSync(path.join(elsewhere, 'README.txt'), 'utf8'), /WebView2 Runtime/);
  assert.match(fs.readFileSync(path.join(elsewhere, 'README.txt'), 'utf8'), /%APPDATA%\\ScCode/);
});
test('dev and release unpack stay separate, rebuilding replaces own files and clean preserves both', t => {
  const base = fixture(t), release = buildPaths([], base), debug = buildPaths(['--debug'], base);
  runtimeFixture(base, release, 'release'); runtimeFixture(base, debug, 'debug');
  exportUnpack(base, release); exportUnpack(base, debug);
  write(path.join(release.build, 'ScCode.exe'), 'release v2');
  exportUnpack(base, release);
  clean(base);
  assert.equal(fs.readFileSync(path.join(release.unpack, 'ScCode.exe'), 'utf8'), 'release v2');
  assert.equal(fs.readFileSync(path.join(debug.unpack, 'ScCode.exe'), 'utf8'), 'debug');
});
test('missing/stale runtime and builtin artifacts cannot replace a good unpack', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths, 'good'); exportUnpack(base, paths);
  const node = path.join(paths.build, 'bin/node.exe'); fs.unlinkSync(node);
  assert.throws(() => exportUnpack(base, paths), /Missing unpack resource/);
  runtimeFixture(base, paths, 'new'); write(node, 'tampered');
  assert.throws(() => exportUnpack(base, paths), /stale unpack resource/);
  runtimeFixture(base, paths); write(path.join(paths.build, 'extensions/git/main.js'), 'tampered');
  assert.throws(() => exportUnpack(base, paths), /builtin extensions hash/);
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'ScCode.exe'), 'utf8'), 'good');
});
test('test host modules, malformed runtime paths and cross targets are rejected', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths); write(path.join(paths.build, 'extension-host/example.test.cjs'));
  assert.throws(() => exportUnpack(base, paths), /Test modules/);
  fs.unlinkSync(path.join(paths.build, 'extension-host/example.test.cjs'));
  const file = path.join(paths.build, 'runtime-manifest.json'); const manifest = JSON.parse(fs.readFileSync(file));
  manifest.resources['.runtime/desktop/../escape'] = 'bad'; write(file, JSON.stringify(manifest));
  assert.throws(() => exportUnpack(base, paths), /Invalid unpack relative path/);
  assert.throws(() => exportUnpack(base, buildPaths(['--target', 'aarch64-pc-windows-msvc'], base)), /native Windows x64/);
  assert.equal(fs.existsSync(paths.unpack), false);
});
test('missing runtime rejects a successful installer runner before either finished package is replaced', t => {
  const base = fixture(t), paths = buildPaths([], base);
  write(path.join(paths.packages, 'ScCode-setup.exe'), 'old good installer');
  assert.throws(() => buildDesktop([], { base, preflight() {}, runCommand() {
    write(path.join(paths.bundle, 'nsis/ScCode-setup.exe'), 'new installer');
  } }), /Missing unpack resource/);
  assert.equal(fs.readFileSync(path.join(paths.packages, 'ScCode-setup.exe'), 'utf8'), 'old good installer');
  assert.equal(fs.existsSync(paths.unpack), false);
});
test('extra user files/directories and unmanaged unpack block replacement without deletion', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths); write(path.join(paths.unpack, 'user.txt'), 'keep');
  assert.throws(() => exportUnpack(base, paths), /unmanaged unpack/);
  fs.unlinkSync(path.join(paths.unpack, 'user.txt')); fs.rmdirSync(paths.unpack);
  exportUnpack(base, paths); write(path.join(paths.unpack, 'data/settings.json'), 'keep');
  assert.throws(() => exportUnpack(base, paths), /extra.user files/);
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'data/settings.json'), 'utf8'), 'keep');
  fs.unlinkSync(path.join(paths.unpack, 'data/settings.json'));
  assert.throws(() => exportUnpack(base, paths), /extra.user directory/);
  assert.throws(() => removeStage(base, paths.unpack), /outside package staging/);
});
test('unpack rejects destination and resource junctions without following them', t => {
  const base = fixture(t), outside = fixture(t), paths = buildPaths([], base);
  fs.unlinkSync(path.join(outside, 'package.json'));
  runtimeFixture(base, paths); fs.mkdirSync(path.dirname(paths.unpack), { recursive: true });
  fs.symlinkSync(outside, paths.unpack, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exportUnpack(base, paths), /link/); fs.unlinkSync(paths.unpack);
  fs.symlinkSync(outside, path.join(paths.build, 'extensions/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exportUnpack(base, paths), /link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test('built profile runtime is used rather than a newer unrelated preparation tree', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths); write(path.join(base, '.runtime/desktop/bin/node.exe'), 'unrelated runtime');
  exportUnpack(base, paths);
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'bin/node.exe'), 'utf8'), 'resource');
});

test('shipped host uses file hashes, not source tree fingerprint containing development shims', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths);
  const file = path.join(paths.build, 'runtime-manifest.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.hostSourceHash = 'source-only-local-shim-fingerprint';
  write(file, JSON.stringify(manifest));
  exportUnpack(base, paths);
  write(path.join(paths.build, 'extension-host/host.cjs'), 'tampered');
  assert.throws(() => exportUnpack(base, paths), /stale unpack resource/);
});

test('published unpack is archived beside installers with one root folder', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths); exportUnpack(base, paths);
  const output = archiveUnpack(base, paths);
  assert.equal(output, path.join(base, 'packages/release/ScCode_0.1.1_x64-unpack.zip'));
  const archive = fs.readFileSync(output);
  assert.equal(archive.subarray(0, 4).toString('hex'), '504b0304');
  const text = archive.toString('latin1');
  for (const entry of ['ScCode_0.1.1_x64-unpack/ScCode.exe', 'ScCode_0.1.1_x64-unpack/unpack-manifest.json', 'ScCode_0.1.1_x64-unpack/extensions/git/main.js']) assert.ok(text.includes(entry), entry);
  assert.equal(archive.subarray(-22, -18).toString('hex'), '504b0506');
});
test('failed staged publish restores the previous unpack and removes the temporary new tree', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths, 'old good'); exportUnpack(base, paths);
  write(path.join(paths.build, 'ScCode.exe'), 'new build');
  const rename = fs.renameSync;
  fs.renameSync = function(source, destination) {
    if (destination === paths.unpack && !source.endsWith('-previous')) throw new Error('simulated publish failure');
    return rename(source, destination);
  };
  try { assert.throws(() => exportUnpack(base, paths), /simulated publish failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'ScCode.exe'), 'utf8'), 'old good');
  assert.deepEqual(fs.readdirSync(path.join(base, '.runtime/package-staging')), []);
});
