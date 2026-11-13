'use strict';
// 回归防护：Claude Code 2.1.x 在模块加载阶段就执行
// `vscode.NotebookCellOutputItem.error(new Error('')).mime`。真实宿主若不导出
// notebook 类型，扩展加载会直接抛 "Cannot read properties of undefined
// (reading 'error')"，所有 Claude Code 命令（含 Chat 面板）都不会注册。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const typesPath = path.join(root, 'src/vs/workbench/api/common/extHostTypes/notebooks.ts');
const apiPath = path.join(root, 'src/vs/workbench/api/common/extHost.api.impl.ts');

function loadNotebookTypes() {
  const source = fs.readFileSync(typesPath, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, id => { throw new Error(`unexpected import: ${id}`); });
  return exports;
}

test('NotebookCellOutputItem.error is constructible and exposes the notebook error MIME', () => {
  const { NotebookCellOutputItem } = loadNotebookTypes();
  const item = NotebookCellOutputItem.error(new Error('synthetic failure'));
  assert.equal(item.mime, 'application/vnd.code.notebook.error');
  const payload = JSON.parse(new TextDecoder().decode(item.data));
  assert.equal(payload.message, 'synthetic failure');
});

test('real extension host exports the notebook data types used by third-party extensions', () => {
  const source = fs.readFileSync(apiPath, 'utf8');
  for (const name of [
    'NotebookCellData',
    'NotebookCellKind',
    'NotebookCellOutput',
    'NotebookCellOutputItem',
    'NotebookData',
    'NotebookEdit',
    'NotebookRange',
  ]) {
    assert.match(source, new RegExp(`\\b${name}:\\s*extHostTypes\\.${name}\\b`), `${name} must be exported by the vscode API`);
  }
});
