'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../src/vs/workbench/contrib/scCodeComplete/browser/scCodeCompleteService.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const request = { prefix: 'function example() {', suffix: '\n}', language: 'typescript', filePath: '/example.ts', maxTokens: 32 };
function fixture(base, tauri = false) {
  const calls = [], exports = {}, fetch = async (url, options) => { calls.push({ url, ...options }); return { ok: true, text: async () => url.startsWith('http://127.0.0.1:4001') ? '{"completion":" return 1;"}' : '{"choices":[{"text":" return 2;"}]}' }; };
  const bridge = { isTauri: () => tauri, invoke: async () => { throw Error('local URL not allowed by marketplace proxy'); } };
  const local = { getServerEndpoint: () => ({ httpUrl: 'http://127.0.0.1:4001' }), localServerHeaders: url => url.startsWith('http://127.0.0.1:4001') ? { Authorization: 'Bearer synthetic-token' } : {} };
  new Function('exports', 'require', 'fetch', js)(exports, id => id.includes('scCodeBridge') ? bridge : id.includes('localServer') ? local : {}, fetch);
  return { service: new exports.ScCodeCompleteService(async () => base), calls };
}
test('default completion sends prefix/suffix to Agent and parses completion with native auth', async () => {
  const f = fixture('http://127.0.0.1:4001'); const result = await f.service.complete(request);
  assert.equal(result.text, ' return 1;'); assert.equal(f.calls[0].url, 'http://127.0.0.1:4001/v1/completions');
  assert.deepEqual(JSON.parse(f.calls[0].body), { prefix: request.prefix, suffix: request.suffix, file_path: request.filePath, language: request.language });
  assert.equal(f.calls[0].headers.Authorization, 'Bearer synthetic-token');
});
test('external completion retains OpenAI format without leaking local credentials', async () => {
  const f = fixture('https://example.com'); const result = await f.service.complete(request);
  assert.equal(result.text, ' return 2;'); const payload = JSON.parse(f.calls[0].body);
  assert.ok(payload.prompt.includes(request.prefix)); assert.equal(payload.max_tokens, 32);
  assert.equal(payload.prefix, undefined); assert.equal(f.calls[0].headers.Authorization, undefined);
});
test('streaming Agent adapter and Tauri fetch fallback use the same contract', async () => {
  const f = fixture('http://127.0.0.1:4001', true), tokens = [];
  const result = await f.service.completeStreaming(request, { onToken: token => tokens.push(token) });
  assert.equal(result.text, ' return 1;'); assert.deepEqual(tokens, [' return 1;']);
  assert.equal(JSON.parse(f.calls[0].body).prefix, request.prefix);
});
test('pre-aborted completion does not send a request', async () => {
  const f = fixture('http://127.0.0.1:4001'), controller = new AbortController(); controller.abort();
  assert.equal(await f.service.complete(request, controller.signal), null); assert.equal(f.calls.length, 0);
});
