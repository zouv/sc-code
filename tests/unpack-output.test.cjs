'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildPaths } = require('../scripts/package-output.cjs');
const { exportUnpack, validateUnpack, requiredFiles, resourceDirs, removeStage } = require('../scripts/unpack-output.cjs');
const { clean } = require('../scripts/daily.cjs');
const { sha256 } = require('../scripts/desktop-runtime.cjs');
const { readZipEntries, readZipEntry } = require('../scripts/zip-writer.cjs');
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
const releaseName = 'ScCode_0.1.1_x64-unpack';
const debugName = 'ScCode_0.1.1_x64-unpack-debug';
test('unpack resources match both Tauri resource configurations', () => {
  const root = path.resolve(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  for (const destination of Object.values(config.bundle.resources)) assert.ok(destination.endsWith('/') ? resourceDirs.includes(destination.slice(0, -1)) : requiredFiles.includes(destination), destination);
  const preparation = fs.readFileSync(path.join(root, 'scripts/prepare-desktop-runtime.cjs'), 'utf8');
  for (const name of ['bin', 'extension-host', 'extensions', 'licenses']) assert.ok(preparation.includes("'" + name + "/':'" + name + "/'"));
  assert.ok(preparation.includes("'sidex-server.exe':'sidex-server.exe'"));
  assert.ok(preparation.includes("'manifest.json':'runtime-manifest.json'"));
});
test('complete Release unpack is archived with runtime/licenses/DLLs but excludes build cache and symbols', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths);
  for (const file of ['ScCode.pdb', 'ScCode.d', 'deps/cache', 'bundle/nsis/installer.exe', 'build/cache', '.cargo-lock']) write(path.join(paths.build, file), 'do not ship');
  write(path.join(paths.build, 'WebView2Loader.dll'), 'optional app-local DLL');
  const zip = exportUnpack(base, paths);
  assert.equal(zip, path.join(base, 'packages/release', releaseName + '.zip'));
  const entries = readZipEntries(zip).map(entry => entry.name);
  for (const relative of requiredFiles.filter(file => !['ScCode.exe', 'runtime-manifest.json'].includes(file))) assert.equal(readZipEntry(zip, releaseName + '/' + relative).toString(), 'resource');
  assert.equal(readZipEntry(zip, releaseName + '/ScCode.exe').toString(), 'executable');
  assert.equal(JSON.parse(readZipEntry(zip, releaseName + '/runtime-manifest.json').toString()).platform, 'win32-x64');
  assert.equal(readZipEntry(zip, releaseName + '/licenses/ScCode-LICENSE.txt').toString(), 'project license');
  assert.equal(readZipEntry(zip, releaseName + '/WebView2Loader.dll').toString(), 'optional app-local DLL');
  for (const file of ['ScCode.pdb', 'ScCode.d', 'deps/cache', 'bundle/nsis/installer.exe', 'build/cache', '.cargo-lock']) assert.equal(entries.some(name => name.endsWith('/' + file)), false, file);
  assert.ok(entries.every(name => name.startsWith(releaseName + '/')));
  assert.equal(fs.existsSync(path.join(base, 'packages/unpack')), false);
  const manifest = JSON.parse(readZipEntry(zip, releaseName + '/unpack-manifest.json').toString());
  for (const file of manifest.files) {
    const source = path.join(paths.build, file.path);
    if (!fs.existsSync(source)) continue; // README/manifest and the generated project license are not build outputs.
    assert.equal(sha256(source), file.sha256, file.path);
  }
  const readme = readZipEntry(zip, releaseName + '/README.txt').toString();
  assert.match(readme, /WebView2 Runtime/);
  assert.match(readme, /%APPDATA%\\ScCode/);
});
test('Debug archive keeps PDB symbols and uses a distinct name', t => {
  const base = fixture(t), paths = buildPaths(['--debug'], base);
  runtimeFixture(base, paths, 'debug executable');
  write(path.join(paths.build, 'ScCode.pdb'), 'debug symbols');
  const zip = exportUnpack(base, paths);
  assert.equal(zip, path.join(base, 'packages/dev', debugName + '.zip'));
  const entries = readZipEntries(zip).map(entry => entry.name);
  assert.equal(readZipEntry(zip, debugName + '/ScCode.pdb').toString(), 'debug symbols');
  assert.equal(readZipEntry(zip, debugName + '/ScCode.exe').toString(), 'debug executable');
  assert.match(readZipEntry(zip, debugName + '/README.txt').toString(), /PDB symbols/);
  assert.equal(entries.some(name => name.startsWith(releaseName + '/')), false);
});
test('dev and release archives stay separate and rebuilding replaces the same zip', t => {
  const base = fixture(t), release = buildPaths([], base), debug = buildPaths(['--debug'], base);
  runtimeFixture(base, release, 'release'); runtimeFixture(base, debug, 'debug');
  const releaseZip = exportUnpack(base, release);
  const debugZip = exportUnpack(base, debug);
  write(path.join(release.build, 'ScCode.exe'), 'release v2');
  exportUnpack(base, release);
  clean(base);
  assert.equal(readZipEntry(releaseZip, releaseName + '/ScCode.exe').toString(), 'release v2');
  assert.equal(readZipEntry(debugZip, debugName + '/ScCode.exe').toString(), 'debug');
  assert.deepEqual(fs.readdirSync(release.packages), [releaseName + '.zip']);
  assert.deepEqual(fs.readdirSync(debug.packages), [debugName + '.zip']);
});
test('missing/stale runtime and builtin artifacts cannot replace a good archive', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths, 'good'); const zip = exportUnpack(base, paths);
  const node = path.join(paths.build, 'bin/node.exe'); fs.unlinkSync(node);
  assert.throws(() => exportUnpack(base, paths), /Missing unpack resource/);
  runtimeFixture(base, paths, 'new'); write(node, 'tampered');
  assert.throws(() => exportUnpack(base, paths), /stale unpack resource/);
  runtimeFixture(base, paths); write(path.join(paths.build, 'extensions/git/main.js'), 'tampered');
  assert.throws(() => exportUnpack(base, paths), /builtin extensions hash/);
  assert.equal(readZipEntry(zip, releaseName + '/ScCode.exe').toString(), 'good');
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
  assert.equal(fs.existsSync(paths.packages), false);
  assert.throws(() => removeStage(base, base), /outside package staging/);
});
test('resource junctions are rejected without following them', t => {
  const base = fixture(t), outside = fixture(t), paths = buildPaths([], base);
  fs.unlinkSync(path.join(outside, 'package.json'));
  runtimeFixture(base, paths);
  fs.symlinkSync(outside, path.join(paths.build, 'extensions/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exportUnpack(base, paths), /link/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(paths.packages), false);
});
test('built profile runtime is used rather than a newer unrelated preparation tree', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths); write(path.join(base, '.runtime/desktop/bin/node.exe'), 'unrelated runtime');
  const zip = exportUnpack(base, paths);
  assert.equal(readZipEntry(zip, releaseName + '/bin/node.exe').toString(), 'resource');
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
test('failed archive write keeps the previous zip and removes the partial file', t => {
  const base = fixture(t), paths = buildPaths([], base);
  runtimeFixture(base, paths, 'old good');
  const zip = exportUnpack(base, paths);
  write(path.join(paths.build, 'ScCode.exe'), 'new build');
  const rename = fs.renameSync;
  fs.renameSync = function(source, destination) {
    if (destination === zip) throw new Error('simulated archive failure');
    return rename(source, destination);
  };
  try { assert.throws(() => exportUnpack(base, paths), /simulated archive failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(readZipEntry(zip, releaseName + '/ScCode.exe').toString(), 'old good');
  assert.equal(fs.existsSync(zip + '.partial'), false);
  assert.deepEqual(fs.readdirSync(path.join(base, '.runtime/package-staging')), []);
});
