'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, modulePath, glue) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/vs/base/common', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, imports = [];
  new Function('exports', 'require', js)(exports, id => {
    imports.push(id); assert.equal(id, modulePath);
    if (!glue) { throw new Error('optional WASM asset missing'); }
    return glue;
  });
  return { exports, imports };
}
test('hash loader imports same-origin glue once and preserves streaming API', async () => {
  let inits = 0;
  const f = load('hashWasm.ts', '/wasm/hash/sc_code_hash_wasm.js', { default: async () => { inits++; }, sha1_hash: input => `hash:${input}`, Sha1: class { value = ''; update_str(input) { this.value += input; } digest() { return this.value; } } });
  assert.equal(f.exports.wasmSha1('early'), null);
  await new Promise(setImmediate);
  assert.equal(inits, 1); assert.equal(f.imports.length, 1);
  assert.equal(f.exports.isHashWasmReady(), true);
  assert.equal(f.exports.wasmSha1('value'), 'hash:value');
  const handle = f.exports.wasmSha1Streaming(); handle.update('a'); handle.update('b'); assert.equal(handle.digest(), 'ab');
});
test('TF-IDF loader imports same-origin glue once and preserves JSON conversion', async () => {
  let inits = 0, updated, freed = false;
  const f = load('tfIdfWasm.ts', '/wasm/tfidf/sc_code_tfidf_wasm.js', { default: async () => { inits++; }, TfIdfEngine: class { update_document(key, chunks) { updated = [key, chunks]; } delete_document() {} calculate_scores(query) { return query === 'bad' ? 'invalid' : '[{"key":"a","score":7}]'; } free() { freed = true; } } });
  await new Promise(setImmediate); assert.equal(inits, 1); assert.equal(f.imports.length, 1);
  assert.equal(f.exports.isWasmTfIdfReady(), true);
  const engine = f.exports.createWasmTfIdfEngine(); engine.updateDocument('a', ['text']); assert.deepEqual(updated, ['a', '["text"]']);
  assert.deepEqual(engine.calculateScores('text'), [{ key: 'a', score: 7 }]); assert.deepEqual(engine.calculateScores('bad'), []);
  engine.free(); assert.equal(freed, true);
});
test('missing optional WASM assets stay on the JS fallback without unhandled rejection', async () => {
  const hash = load('hashWasm.ts', '/wasm/hash/sc_code_hash_wasm.js');
  const tfidf = load('tfIdfWasm.ts', '/wasm/tfidf/sc_code_tfidf_wasm.js');
  await new Promise(setImmediate);
  assert.equal(hash.exports.isHashWasmReady(), false); assert.equal(hash.exports.wasmSha1('value'), null); assert.equal(hash.exports.wasmSha1Streaming(), null);
  assert.equal(tfidf.exports.isWasmTfIdfReady(), false); assert.equal(tfidf.exports.createWasmTfIdfEngine(), null);
});
