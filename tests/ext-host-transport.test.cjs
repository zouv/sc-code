'use strict';
// 回归防护：发布版 workbench 从 https://tauri.localhost 加载，而本地真实扩展
// 宿主由 Rust 监管进程提供明文 ws。BrowserSocketFactory 默认按页面协议选 wss，
// 会让发布版连接 127.0.0.1 时报 ERR_SSL_PROTOCOL_ERROR，全部扩展命令失效。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const transport = fs.readFileSync(path.join(root, 'src/vs/workbench/services/extensions/browser/tauriProcessExtensionHost.ts'), 'utf8');
const factory = fs.readFileSync(path.join(root, 'src/vs/platform/remote/browser/browserSocketFactory.ts'), 'utf8');

test('real extension host pins plain ws for the loopback supervisor', () => {
  assert.match(factory, /scheme\?: 'ws' \| 'wss'/, 'BrowserSocketFactory must allow an explicit scheme');
  assert.match(factory, /scheme \?\?/, 'explicit scheme must take precedence over the https-derived default');
  assert.match(transport, /'extensionHost',[\s\S]{0,600}?'ws'/, 'the local extension host must pass ws explicitly');
});
