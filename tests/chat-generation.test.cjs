'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/vs/workbench/contrib/sidexChat/browser/sidexChatService.ts'), 'utf8');
const file = ts.createSourceFile('chat.ts', source, ts.ScriptTarget.Latest, true);
let method;
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === '_sendWithContext') method = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(method, 'actual send method located by AST');
const Harness = new Function('LOCAL_TOOLS_SUPPORTED', ts.transpile(`class Harness { ${method} }; return Harness`, { target: ts.ScriptTarget.ES2022 }))(() => true);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(checkpoint = Promise.resolve()) {
  const sent = [], h = new Harness();
  Object.assign(h, { _sendGeneration: 1, _isStreaming: true, _checkpointReady: checkpoint, _connectionState: 'connected',
    _contextIndexed: false, _useDynamicContext: true, _ws: { send(value) { sent.push(JSON.parse(value)); } },
    _setStreaming(value) { this._isStreaming = value; },
    _gatherWorkspaceContext() { return { cwd: '', openFiles: [], workspaceFolders: [] }; }, _buildRecentEditContext() { return ''; } });
  return { h, sent, cancel() { h._sendGeneration++; h._isStreaming = false; } };
}
test('cancel while awaiting checkpoint cannot send the old turn or interfere with a new turn', async () => {
  const gate = deferred(), f = fixture(gate.promise);
  const old = f.h._sendWithContext('old'); f.cancel();
  f.h._checkpointReady = Promise.resolve(); f.h._isStreaming = true;
  await f.h._sendWithContext('new'); gate.resolve(); await old;
  assert.deepEqual(f.sent.map(p => p.message), ['new']); assert.equal(f.h._isStreaming, true);
});
test('cancel or disconnect while awaiting context search cannot send a stale turn', async () => {
  for (const action of ['cancel', 'disconnect']) {
    const gate = deferred(), started = deferred(), f = fixture(); f.h._contextIndexed = true;
    f.h._localExecutor = { execute() { started.resolve(); return gate.promise; } };
    const old = f.h._sendWithContext('old'); await started.promise;
    if (action === 'cancel') f.cancel(); else f.h._connectionState = 'disconnected';
    gate.resolve({ output: 'context' }); await old; assert.deepEqual(f.sent, []);
  }
});
