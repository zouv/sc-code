'use strict';
// 回归防护：Tauri 编译期会给 index.html 的静态 <style> 注入 nonce，运行期把
// 'nonce-…' 追加进 style-src。按 CSP 规范，style-src 一旦含 nonce/hash，
// 'unsafe-inline' 即失效；而 VS Code 的主题变量、codicon 字形与菜单控件样式
// 都靠运行时创建的无 nonce <style> 注入，会被整体拦截（0.4.1 图标/菜单回归）。
// 因此必须只对 style-src 关闭 Tauri 的自动 nonce/hash 注入，script-src 保持加固。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const security = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security;
test('style-src keeps unsafe-inline effective for runtime workbench styles', () => {
  assert.ok(security.csp, 'production CSP must not be disabled');
  assert.match(security.csp['style-src'], /'unsafe-inline'/);
  assert.ok(Array.isArray(security.dangerousDisableAssetCspModification), 'style-src must opt out of Tauri nonce/hash injection');
  assert.ok(security.dangerousDisableAssetCspModification.includes('style-src'));
  assert.ok(!security.dangerousDisableAssetCspModification.includes('script-src'), 'script-src must keep Tauri nonce/hash injection');
});
test('production CSP keeps script execution strict', () => {
  assert.match(security.csp['script-src'], /'self'/);
  assert.match(security.csp['script-src'], /'wasm-unsafe-eval'/);
  assert.doesNotMatch(security.csp['script-src'], /'unsafe-inline'/);
});
