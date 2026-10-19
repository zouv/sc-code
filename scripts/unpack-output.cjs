'use strict';
// Windows unpacked distribution: archive the built profile, never mix a stale EXE with source runtime.
// Published layout: packages/dev only has the Debug unpack zip; packages/release has the setup exe and Release unpack zip.
const fs = require('node:fs');
const path = require('node:path');
const { assertLocalPath } = require('./package-output.cjs');
const { sha256, treeHash, validateExtensions } = require('./desktop-runtime.cjs');
const { writeZip, readZipEntries } = require('./zip-writer.cjs');
const resourceDirs = ['bin', 'extension-host', 'extensions', 'licenses', 'shell-integration'];
const requiredFiles = ['ScCode.exe', 'bin/node.exe', 'sidex-server.exe', 'runtime-manifest.json', 'extension-host/extensionHost.cjs',
  ...['server', 'host', 'configuration', 'transport-auth', 'storage'].map(name => 'extension-host/' + name + '.cjs'),
  'shell-integration/shellIntegration.ps1'];
function relativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid unpack relative path: ' + value);
  return value;
}
function inventory(base, directory) {
  const result = [];
  function visit(folder) {
    assertLocalPath(base, folder);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = assertLocalPath(base, path.join(folder, entry.name));
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) result.push(file);
      else throw new Error('Unsupported unpack resource: ' + file);
    }
  }
  visit(directory);
  return result.sort();
}
function validateUnpack(base, directory) {
  for (const relative of requiredFiles) {
    const file = assertLocalPath(base, path.join(directory, relative));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) throw new Error('Missing unpack resource: ' + relative);
  }
  // Scan first: validators must never traverse a junction or symlink.
  for (const name of resourceDirs) inventory(base, path.join(directory, name));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'runtime-manifest.json'), 'utf8'));
  if (manifest.platform !== 'win32-x64') throw new Error('Unpack currently supports the prepared Windows x64 runtime only');
  for (const relative of requiredFiles.filter(file => file !== 'ScCode.exe' && file !== 'runtime-manifest.json' && !file.startsWith('shell-integration/'))) {
    if (!manifest.resources?.['.runtime/desktop/' + relative]) throw new Error('Unhashed unpack runtime resource: ' + relative);
  }
  for (const [source, hash] of Object.entries(manifest.resources || {})) {
    if (!source.startsWith('.runtime/desktop/')) throw new Error('Invalid runtime resource path: ' + source);
    const relative = relativeFile(source.slice('.runtime/desktop/'.length));
    const file = assertLocalPath(base, path.join(directory, relative));
    if (!fs.existsSync(file) || sha256(file) !== hash) throw new Error('Missing/stale unpack resource: ' + relative);
  }
  if (treeHash(path.join(directory, 'extensions')) !== manifest.extensionsHash) throw new Error('Unpack builtin extensions hash mismatch');
  // hostSourceHash fingerprints the SOURCE tree (including local development shims), not the shipped host.
  // Shipped host modules were validated individually against manifest.resources above.
  const descriptors = validateExtensions(path.join(directory, 'extensions'));
  if (descriptors.length !== manifest.builtinCount || JSON.stringify(descriptors) !== JSON.stringify(manifest.builtinDescriptors)) throw new Error('Unpack builtin descriptors mismatch');
  if (fs.readdirSync(path.join(directory, 'extension-host')).some(name => name.endsWith('.test.cjs'))) throw new Error('Test modules must not ship in unpack');
  return manifest;
}
function removeStage(base, folder) {
  const stagingRoot = path.join(fs.realpathSync(base), '.runtime/package-staging');
  if (!path.resolve(folder).startsWith(stagingRoot + path.sep)) throw new Error('Refusing cleanup outside package staging: ' + folder);
  assertLocalPath(base, folder);
  if (!fs.existsSync(folder)) return;
  inventory(base, folder); // Validate descendants before any recursive removal.
  fs.rmSync(folder, { recursive: true, force: true });
}
function prepareUnpack(base, paths) {
  assertLocalPath(base, paths.build);
  const targetRoot = path.join(fs.realpathSync(base), '.runtime/target');
  if (![path.join(targetRoot, paths.mode.toLowerCase()), path.join(targetRoot, 'x86_64-pc-windows-msvc', paths.mode.toLowerCase())].includes(paths.build)) throw new Error('Unpack currently supports native Windows x64 builds only');
  const runtime = validateUnpack(base, paths.build);
  const selected = ['ScCode.exe', 'sidex-server.exe', 'runtime-manifest.json',
    ...resourceDirs.flatMap(name => inventory(base, path.join(paths.build, name)).map(file => path.relative(paths.build, file))),
    ...fs.readdirSync(paths.build).filter(name => name.toLowerCase().endsWith('.dll'))];
  // Debug packages keep PDB symbols for local diagnostics; Release packages never ship Cargo caches or symbols.
  if (paths.mode === 'Debug') selected.push(...fs.readdirSync(paths.build).filter(name => name.toLowerCase().endsWith('.pdb')));
  const sources = selected.map(relative => ({ source: assertLocalPath(base, path.join(paths.build, relative)), relative }));
  for (const [source, relative] of [['LICENSE', 'licenses/ScCode-LICENSE.txt']]) {
    const file = assertLocalPath(base, path.join(base, source));
    if (!fs.existsSync(file)) throw new Error('Missing project license: ' + source);
    sources.push({ source: file, relative });
  }
  const stagingRoot = assertLocalPath(base, path.join(base, '.runtime/package-staging'));
  fs.mkdirSync(stagingRoot, { recursive: true });
  const stage = fs.mkdtempSync(path.join(stagingRoot, 'unpack-'));
  try {
    for (const { source, relative } of sources) {
      const output = assertLocalPath(base, path.join(stage, relative));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(source, output);
      if (sha256(source) !== sha256(output)) throw new Error('Unpack copy checksum mismatch: ' + relative);
    }
    validateUnpack(base, stage);
    fs.writeFileSync(path.join(stage, 'README.txt'),
      'ScCode - Windows x64 (' + paths.mode + ') unpacked distribution\r\n\r\n' +
      'Double-click ScCode.exe. No installation, Node.js or source checkout required.\r\n' +
      'Microsoft Edge WebView2 Runtime must already be installed on this computer.\r\n' +
      'Move/copy the WHOLE folder; do not move only ScCode.exe.\r\n' +
      'User data: %APPDATA%\\ScCode by default (or SC_CODE_HOME). This is NOT an in-folder data-portable mode.\r\n' +
      (paths.mode === 'Debug' ? 'Debug build: unoptimized binaries and PDB symbols may be included for local diagnostics.\r\n' : '') +
      'Local unsigned build; no signing, installation or publishing was performed.\r\n');
    const files = inventory(base, stage).map(file => ({ path: path.relative(stage, file).replaceAll('\\', '/'), size: fs.statSync(file).size, sha256: sha256(file) }));
    fs.writeFileSync(path.join(stage, 'unpack-manifest.json'), JSON.stringify({ format: 1, product: 'ScCode', mode: paths.mode,
      platform: runtime.platform, builtinCount: runtime.builtinCount, createdAt: new Date().toISOString(), files }, null, 2) + '\n');
    return { base, stage };
  } catch (error) { removeStage(base, stage); throw error; }
}
function archiveUnpack(base, paths, stage) {
  const source = assertLocalPath(base, stage);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('Unpack staging directory is missing: ' + source);
  const version = JSON.parse(fs.readFileSync(path.join(fs.realpathSync(base), 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid product version for unpack archive: ' + version);
  const folder = 'ScCode_' + version + '_x64-unpack' + (paths.mode === 'Debug' ? '-debug' : '');
  const destination = assertLocalPath(base, paths.packages);
  const output = assertLocalPath(base, path.join(destination, folder + '.zip'));
  const files = inventory(base, source);
  if (files.length >= 0xffff) throw new Error('Too many unpack files for ZIP: ' + files.length);
  const entries = files.map(file => {
    const stat = fs.statSync(file);
    if (stat.size > 0xffffffff) throw new Error('Unpack file too large for ZIP: ' + file);
    return { name: folder + '/' + path.relative(source, file).replaceAll('\\', '/'), file, mtime: stat.mtime };
  });
  fs.mkdirSync(destination, { recursive: true });
  const result = writeZip(output, entries);
  const archived = readZipEntries(output).map(entry => entry.name).sort();
  const expected = entries.map(entry => entry.name).sort();
  if (JSON.stringify(archived) !== JSON.stringify(expected)) throw new Error('Unpack archive entry mismatch: ' + output);
  console.log('[ARCHIVE] ' + result.output);
  return result.output;
}
function exportUnpack(base, paths) {
  const prepared = prepareUnpack(base, paths);
  try { return archiveUnpack(base, paths, prepared.stage); }
  finally { removeStage(base, prepared.stage); }
}
module.exports = { resourceDirs, requiredFiles, validateUnpack, prepareUnpack, archiveUnpack, exportUnpack, removeStage };
