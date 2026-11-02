'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(relative) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}
const { ChatSessionPersistence } = load('src/vs/workbench/contrib/scCodeChat/browser/chatPersistence.ts');
const message = role => ({ role, content: 'example', timestamp: 1700000000123 });
const session = id => ({ id, title: 'example', model: 'test', mode: 'agent', workspace: '/example' });
const delay = () => Promise.resolve();
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('chat history retries with a stable ID, deduplicates concurrent writes and marks saved only on success', async () => {
  const calls = [], gate = deferred(); let fail = true;
  const writer = new ChatSessionPersistence(async (command, args) => {
    calls.push({ command, args });
    if (command === 'session_save_message') { await gate.promise; if (fail) { fail = false; throw Error('temporary lock'); } }
  }, session('one'), error => assert.fail(String(error)), false, delay);
  const msg = message('assistant'), first = writer.save(msg), duplicate = writer.save(msg);
  assert.equal(first, duplicate); assert.equal(writer.isSaved(msg), false);
  gate.resolve(); await first;
  const writes = calls.filter(c => c.command === 'session_save_message');
  assert.equal(writes.length, 2); assert.equal(writes[0].args.id, writes[1].args.id);
  assert.equal(writer.isSaved(msg), true); await writer.save(msg); assert.equal(calls.length, 3);
});

test('creation failure is visible and a later retry creates the session before saving', async () => {
  const calls = [], errors = []; let broken = true;
  const writer = new ChatSessionPersistence(async (command, args) => {
    calls.push({ command, args }); if (broken) { throw Error('disk unavailable'); }
  }, session('two'), error => errors.push(error), false, delay);
  const msg = message('user'); await writer.save(msg);
  assert.equal(errors.length, 1); assert.equal(writer.isSaved(msg), false);
  assert.equal(calls.length, 3); assert.ok(calls.every(c => c.command === 'session_create'));
  broken = false; await writer.save(msg);
  assert.deepEqual(calls.slice(3).map(c => c.command), ['session_create', 'session_save_message']);
  assert.equal(writer.isSaved(msg), true);
});

test('failed message writes remain retryable and do not duplicate a saved message', async () => {
  const calls = [], errors = []; let broken = true;
  const writer = new ChatSessionPersistence(async (command, args) => {
    calls.push({ command, args }); if (command === 'session_save_message' && broken) { throw Error('busy'); }
  }, session('three'), error => errors.push(error), false, delay);
  const msg = message('assistant'); await writer.save(msg);
  assert.equal(writer.isSaved(msg), false); assert.equal(errors.length, 1);
  const originalID = calls[1].args.id; broken = false;
  writer.retryFailed(); await writer.save(msg);
  assert.equal(writer.isSaved(msg), true); assert.equal(calls.at(-1).args.id, originalID);
  writer.retryFailed(); assert.equal(calls.length, 5);
});

test('switching sessions while creation is pending keeps writes on their original session', async () => {
  const gate = deferred(), calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args }); if (command === 'session_create' && args.id === 'old') { await gate.promise; }
  };
  const old = new ChatSessionPersistence(invoke, session('old'), assert.fail, false, delay);
  const pending = old.save(message('user'));
  const current = new ChatSessionPersistence(invoke, session('new'), assert.fail, false, delay);
  await current.save(message('user')); gate.resolve(); await pending;
  assert.deepEqual(calls.filter(c => c.command === 'session_save_message').map(c => c.args.sessionId), ['new', 'old']);
});

test('loaded messages are already saved, new messages use unique IDs without recreating history', async () => {
  const calls = [], writer = new ChatSessionPersistence(async (command, args) => calls.push({ command, args }), session('loaded'), assert.fail, true, delay);
  const loaded = message('assistant'); writer.markSaved(loaded); await writer.save(loaded);
  await writer.save(message('user')); await writer.save(message('assistant'));
  assert.equal(calls.length, 2); assert.ok(calls.every(c => c.command === 'session_save_message'));
  assert.notEqual(calls[0].args.id, calls[1].args.id);
});


test('same-second message IDs retain chronological order through delayed writes', async () => {
  const calls = [];
  const writer = new ChatSessionPersistence(async (command, args) => calls.push({ command, args }), session('ordered'), assert.fail, true, delay);
  const first = message('user'), second = message('assistant'), third = message('user');
  third.timestamp += 1;
  await writer.save(first); await writer.save(second); await writer.save(third);
  const ids = calls.map(call => call.args.id);
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(calls[0].args.createdAt, calls[2].args.createdAt);
});
