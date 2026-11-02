'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
const files = { FileType, FilePermission: { Readonly: 1 }, FileSystemProviderCapabilities: { FileReadWrite: 1, Trash: 2, PathCaseSensitive: 4 } };
function fixture(relativePath, exportName, raw) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, calls = [];
  const invoke = async (command, args) => { calls.push({ command, args }); return raw; };
  new Function('exports', 'require', js)(exports, id => {
    if (id === '@tauri-apps/api/core' || id.includes('scCodeBridge')) { return { invoke }; }
    if (id.endsWith('/common/files.js')) { return files; }
    if (id.endsWith('/common/lifecycle.js')) { return { Disposable: class {} }; }
    if (id.endsWith('/common/platform.js')) { return { isWindows: true }; }
    if (id.endsWith('/instantiation.js')) { return { createDecorator: () => () => {} }; }
    if (id.endsWith('/extensions.js')) { return { InstantiationType: { Delayed: 1 }, registerSingleton() {} }; }
    return {};
  });
  // Exercise actual adapter methods without unrelated watch/DI initialization.
  return { provider: Object.create(exports[exportName].prototype), calls };
}

for (const [name, file, argument] of [
  ['TauriFileSystemProvider', 'src/vs/platform/files/browser/tauriFileSystemProvider.ts', { scheme: 'file', fsPath: '/fixture' }],
  ['ScCodeFileSystemProvider', 'src/vs/platform/scCode/browser/scCodeFileSystemProvider.ts', '/fixture']
]) {
  test(name + ' preserves native milliseconds and symlink target type bits', async () => {
    for (const [is_dir, is_file, is_symlink, expected] of [
      [false, true, false, FileType.File],
      [true, false, false, FileType.Directory],
      [false, true, true, FileType.File | FileType.SymbolicLink],
      [true, false, true, FileType.Directory | FileType.SymbolicLink],
      [false, false, true, FileType.SymbolicLink]
    ]) {
      const raw = { size: 27, modified: 1700000000123, created: 1700000000456, readonly: true, is_dir, is_file, is_symlink };
      const f = fixture(file, name, raw), stat = await f.provider.stat(argument);
      assert.equal(stat.mtime, raw.modified);
      assert.equal(stat.ctime, raw.created);
      assert.equal(stat.type, expected);
      assert.equal(stat.size, raw.size);
      assert.equal(name === 'ScCodeFileSystemProvider' ? stat.readonly : stat.permissions === files.FilePermission.Readonly, true);
      assert.deepEqual(f.calls, [{ command: 'stat', args: { path: '/fixture' } }]);
    }
  });
}

test('file scheme readdir combines link and target type for linked files and directories', async () => {
  const f = fixture('src/vs/platform/files/browser/tauriFileSystemProvider.ts', 'TauriFileSystemProvider', [
    { name: 'file-link', is_dir: false, is_file: true, is_symlink: true },
    { name: 'dir-link', is_dir: true, is_file: false, is_symlink: true },
    { name: 'broken-link', is_dir: false, is_file: false, is_symlink: true }
  ]);
  assert.deepEqual(await f.provider.readdir({ scheme: 'file', fsPath: '/fixture' }), [
    ['file-link', FileType.File | FileType.SymbolicLink],
    ['dir-link', FileType.Directory | FileType.SymbolicLink],
    ['broken-link', FileType.SymbolicLink]
  ]);
});
