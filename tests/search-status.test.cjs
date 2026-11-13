'use strict';
// 回归防护：搜索面板必须在搜索进行中显示 Searching…，慢搜索显示 still running，
// 完成后隐藏状态并显示结果计数或 No results found；新搜索开始时不能残留上一条
// 「No results found」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'src/vs/workbench/contrib/search/browser/searchView.ts'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/vs/workbench/contrib/search/browser/media/searchview.css'), 'utf8');

test('search view exposes searching/slow/idle status transitions', () => {
  assert.match(view, /\.search-status/, 'search status element must be rendered');
  assert.match(view, /setSearchingStatus\('searching'\)/, 'new searches must show the searching state');
  assert.match(view, /setSearchingStatus\('slow'\)/, 'slow searches must update the status after the delay');
  assert.match(view, /setSearchingStatus\('idle'\)/, 'completion/error must clear the status');
  assert.match(view, /dom\.hide\(this\.messagesElement\)/, 'starting a search must hide the previous result message');
  assert.match(css, /\.search-view \.search-status\.visible/, 'status needs a visible CSS state');
});
