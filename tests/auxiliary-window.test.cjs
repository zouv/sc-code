'use strict';
// 回归防护：VS Code web 工作台用 window.open('about:blank') 创建辅助窗口。
// WebView2 默认拦截弹窗，会出现 "The browser blocked opening a new window"。
// Tauri 主窗口必须注册 on_new_window 并创建 WebView 窗口，辅助窗口关闭时
// 也不能走主工作台的未保存确认钩子。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const windowSource = fs.readFileSync(path.join(root, 'src-tauri/src/commands/window.rs'), 'utf8');
const libSource = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const auxiliarySource = fs.readFileSync(path.join(root, 'src/vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.ts'), 'utf8');

test('Tauri answers WebView2 new-window requests with an auxiliary WebView window', () => {
  assert.match(windowSource, /on_new_window\(/, 'main window must handle window.open');
  assert.match(windowSource, /auxiliary-\{id\}/, 'auxiliary windows need unique labels');
  assert.match(windowSource, /window_features\(features\)/, 'new window must inherit opener size/environment');
  assert.match(windowSource, /WebviewUrl::External\(url\.clone\(\)\)/, 'new window must honor the requested URL');
});

test('auxiliary windows skip the workbench close prompt and wait for their DOM', () => {
  assert.match(libSource, /starts_with\("auxiliary-"\)/, 'auxiliary close requests must not wait for a workbench hook');
  assert.match(auxiliarySource, /whenWindowReady\(targetWindow\)/, 'auxiliary DOM must be ready before cloning main-window nodes');
});
