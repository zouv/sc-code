'use strict';
// 回归防护：扩展安装记录可能指向 Open VSX 的 https 地址（source=gallery），
// 即使 Rust 已把文件下载到本地 extensions 目录。真实 Node 宿主只能加载
// file-scheme 扩展，否则报 "Cannot load URI ... must be of file-scheme"，
// 扩展命令全部不注册（Claude Code 的 Open in New Window 即此现象）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/vs/workbench/services/extensions/browser/extensionService.ts'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'src/sc-code/extension-sync/extensionSync.contribution.ts'), 'utf8');

test('disk extension registration repairs remote/gallery locations to the local file path', () => {
  for (const [name, source] of [['extensionService', service], ['extensionSync', sync]]) {
    assert.match(source, /location\.scheme === 'file'/, `${name} must detect non-file registered locations`);
    assert.match(source, /installFromLocation\(localUri/, `${name} must re-register from the disk URI`);
  }
  assert.match(service, /repaired extension location/, 'real-host registration must log the repair');
  assert.doesNotMatch(service, /installedIds\.has/, 'an existing id must not skip location repair');
});
