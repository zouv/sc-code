'use strict';
// 回归防护：真实 Node 扩展宿主创建输出通道时会用非递归 mkdir 建
// <logsLocation>/output_logging_*。0.5.0 默认切到真实宿主后，logsLocation
// 指向的原生目录不存在，VAC 激活时 createOutputChannel 的 ENOENT 成为
// unhandled rejection，整个扩展宿主退出，侧边栏与 Chat 都打不开。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'src/vs/workbench/services/extensions/browser/scCodeExtHostDirectories.ts');

function loadHelper() {
  const source = fs.readFileSync(helperPath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, id => { throw new Error(`unexpected import: ${id}`); });
  return exports;
}

test('native extension host directories are created in order and failures do not abort the rest', async () => {
  const { ensureScCodeExtHostDirectories } = loadHelper();
  const calls = [], errors = [];
  await ensureScCodeExtHostDirectories(
    ['C:/profile/logs/localProcess', 'C:/profile/User/globalStorage', 'C:/profile/User/workspaceStorage'],
    async directory => {
      calls.push(directory);
      if (directory.endsWith('globalStorage')) { throw new Error('synthetic mkdir failure'); }
    },
    (directory, error) => errors.push([directory, error.message])
  );
  assert.deepEqual(calls, [
    'C:/profile/logs/localProcess',
    'C:/profile/User/globalStorage',
    'C:/profile/User/workspaceStorage',
  ]);
  assert.deepEqual(errors, [['C:/profile/User/globalStorage', 'synthetic mkdir failure']]);
});

test('real host init data pre-creates native log and storage directories', () => {
  const source = fs.readFileSync(path.join(root, 'src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts'), 'utf8');
  assert.match(source, /ensureScCodeExtHostDirectories\(/, 'init data must call the directory helper');
  assert.match(source, /logsLocation\.fsPath/, 'the native logsLocation must be pre-created');
  assert.match(source, /globalStorageHome\.fsPath/, 'the native globalStorageHome must be pre-created');
  assert.match(source, /workspaceStorageHome\.fsPath/, 'the native workspaceStorageHome must be pre-created');
});
