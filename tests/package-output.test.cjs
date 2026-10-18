'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildPaths, installerSnapshot, exportPackages } = require('../scripts/package-output.cjs');
const { buildDesktop } = require('../scripts/build-desktop.cjs');
const { clean } = require('../scripts/daily.cjs');
const { runtimeFixture } = require('./unpack-fixture.cjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc packages-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}
function write(file, contents = 'installer') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}
test('package paths separate Debug/dev and Release/release and resolve target options', t => {
  const base = fixture(t);
  const debug = buildPaths(['--debug', '--target', 'x86_64-pc-windows-msvc'], base);
  assert.equal(debug.packages, path.join(base, 'packages/dev'));
  assert.equal(debug.build, path.join(base, '.runtime/target/x86_64-pc-windows-msvc/debug'));
  const release = buildPaths(['-t', 'x86_64-pc-windows-msvc'], base);
  assert.equal(release.packages, path.join(base, 'packages/release'));
  assert.equal(buildPaths(['-d', '--target=x86_64-pc-windows-msvc'], base).bundle, debug.bundle);
  assert.equal(buildPaths([], base).build, path.join(base, '.runtime/target/release'));
  assert.equal(buildPaths(['--', '--debug'], base).mode, 'Release');
  for (const args of [['--target'], ['--target='], ['--target', '../outside']]) assert.throws(() => buildPaths(args, base), /target/);
});
test('only fresh installers and signatures are exported, build cache and old versions stay untouched', t => {
  const base = fixture(t), paths = buildPaths(['--debug'], base);
  const old = write(path.join(paths.bundle, 'nsis/ScCode_old-setup.exe'), 'old');
  const before = installerSnapshot(base, paths.bundle);
  write(path.join(paths.bundle, 'nsis/ScCode_new-setup.exe'), 'new package');
  write(path.join(paths.bundle, 'nsis/ScCode_new-setup.exe.sig'), 'signature');
  write(path.join(paths.bundle, 'msi/ScCode_new.msi'), 'msi package');
  write(path.join(paths.bundle, 'nsis/installer.nsi'), 'staging source');
  write(path.join(paths.bundle, 'nsis/resources/sidecar.exe'), 'nested resource');
  write(path.join(paths.packages, 'archive.exe'), 'previous exported version');
  const output = exportPackages(base, paths, before);
  assert.equal(output.length, 3);
  assert.equal(fs.readFileSync(path.join(paths.packages, 'ScCode_new-setup.exe'), 'utf8'), 'new package');
  assert.equal(fs.readFileSync(old, 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(paths.packages, 'ScCode_old-setup.exe')), false);
  assert.equal(fs.existsSync(path.join(paths.packages, 'installer.nsi')), false);
  assert.equal(fs.existsSync(path.join(paths.packages, 'sidecar.exe')), false);
  assert.equal(fs.readFileSync(path.join(paths.packages, 'archive.exe'), 'utf8'), 'previous exported version');
  assert.throws(() => exportPackages(base, paths, installerSnapshot(base, paths.bundle)), /No new installer/);
});
test('same-name rebuilt installer replaces exported copy and cleanup preserves both channels', t => {
  const base = fixture(t), paths = buildPaths([], base);
  const file = write(path.join(paths.bundle, 'nsis/ScCode-setup.exe'), 'old');
  const before = installerSnapshot(base, paths.bundle);
  write(file, 'newly rebuilt installer');
  write(path.join(paths.packages, 'ScCode-setup.exe'), 'previous copy');
  write(path.join(base, 'packages/dev/ScCode-setup.exe'), 'debug');
  exportPackages(base, paths, before);
  clean(base);
  assert.equal(fs.readFileSync(path.join(paths.packages, 'ScCode-setup.exe'), 'utf8'), 'newly rebuilt installer');
  assert.equal(fs.readFileSync(path.join(base, 'packages/dev/ScCode-setup.exe'), 'utf8'), 'debug');
});
test('export rejects outside destinations and junctions without writing outside the project', t => {
  const base = fixture(t), outside = fixture(t), paths = buildPaths([], base);
  write(path.join(paths.bundle, 'nsis/ScCode-setup.exe'));
  assert.throws(() => exportPackages(base, { ...paths, packages: outside }, new Map()), /escapes project/);
  fs.symlinkSync(outside, path.join(base, 'packages'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => exportPackages(base, paths, new Map()), /link/);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(base, 'packages'));
});
test('desktop build exports only after a successful runner and pins intermediate output inside .runtime', t => {
  const base = fixture(t), args = ['--debug', '--target', 'x86_64-pc-windows-msvc', '--bundles', 'nsis'];
  const paths = buildPaths(args, base), events = [];
  buildDesktop(args, { base, preflight: () => events.push('preflight'), runCommand(command, cliArgs, options) {
    events.push('runner');
    assert.ok(cliArgs.includes('--debug'));
    assert.equal(options.env.CARGO_TARGET_DIR, path.join(base, '.runtime/target'));
    assert.equal(options.env.CC, undefined);
    assert.equal(options.env.CXX, undefined);
    assert.equal(fs.existsSync(paths.packages), false);
    write(path.join(paths.bundle, 'nsis/ScCode-setup.exe'), 'successful build');
    runtimeFixture(base, paths, 'built desktop');
  }});
  assert.deepEqual(events, ['preflight', 'runner']);
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'ScCode.exe'), 'utf8'), 'built desktop');
  assert.equal(fs.readFileSync(path.join(paths.packages, 'ScCode-setup.exe'), 'utf8'), 'successful build');
  assert.throws(() => buildDesktop(args, { base, preflight() {}, runCommand() {
    write(path.join(paths.bundle, 'nsis/ScCode-setup.exe'), 'failed rebuild');
    write(path.join(paths.build, 'ScCode.exe'), 'failed executable');
    throw Error('build failed');
  }}), /build failed/);
  assert.equal(fs.readFileSync(path.join(paths.packages, 'ScCode-setup.exe'), 'utf8'), 'successful build');
  assert.equal(fs.readFileSync(path.join(paths.unpack, 'ScCode.exe'), 'utf8'), 'built desktop');
});
test('successful runner with no installer fails, while --no-bundle never exports stale packages', t => {
  const base = fixture(t), args = ['--debug'], paths = buildPaths(args, base);
  write(path.join(paths.bundle, 'nsis/old-setup.exe'), 'old package');
  assert.throws(() => buildDesktop(args, { base, preflight() {}, runCommand() {} }), /No new installer/);
  buildDesktop([...args, '--no-bundle'], { base, preflight() {}, runCommand() {} });
  assert.equal(fs.existsSync(paths.packages), false);
  assert.equal(fs.existsSync(paths.unpack), false);
});
