'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../src/vs/workbench/contrib/scCodeChat/browser/scCodeChatService.ts'), 'utf8');
// Execute the actual TypeScript methods with a tiny deterministic transport:
// tests are behavioural, not assertions that a particular string exists.
const methods = ['sendMessage', '_cancelPendingSend', 'stopStreaming', 'disconnect'].map(name => {
  const start = source.indexOf(`\t${name === '_cancelPendingSend' ? 'private ' : ''}${name}(${name === 'sendMessage' ? 'text: string' : ''}): void {`);
  assert.notEqual(start, -1);
  const brace = source.indexOf('{', start); let depth = 1, end = brace + 1;
  for (; depth && end < source.length; end++) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; }
  return source.slice(start, end);
}).join('\n');
function fixture() {
  let timers = new Map(), next = 0, listeners = new Set(), sent = [], enqueued = [], errors = [];
  const js = ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
  const Harness = new Function('setTimeout', 'clearTimeout', js)(fn => { timers.set(++next, fn); return next; }, id => timers.delete(id));
  const h = new Harness();
  Object.assign(h, { _sendGeneration: 0, _isStreaming: false, _isReverting: false, _ws: null, _connectionState: 'disconnected',
    _onDidChangeConnectionState: { event(fn) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; } },
    _onDidReceiveChunk: { fire(e) { errors.push(e); } },
    _enqueueUserMessage(text) { enqueued.push(text); }, _setStreaming(value) { this._isStreaming = value; },
    _sendWithContext(text) { sent.push(text); }, connect() {}, _setConnectionState(s) { this._connectionState = s; }
  });
  return { h, sent, enqueued, errors, timers, listeners, open() { h._ws = { close() {} }; h._connectionState = 'connected'; for (const fn of [...listeners]) fn('connected'); }, expire() { for (const fn of [...timers.values()]) fn(); } };
}
test('offline send reserves one turn and sends exactly once after reconnect', () => {
  const f = fixture(); f.h.sendMessage('hello'); f.h.sendMessage('second');
  assert.equal(f.h._isStreaming, true); assert.deepEqual(f.enqueued, ['hello']);
  f.open(); f.open(); f.expire();
  assert.deepEqual(f.sent, ['hello']); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0); assert.deepEqual(f.errors, []);
});
test('stop/disconnect cancel pending turn and never send it on a later connection', () => {
  for (const action of ['stopStreaming', 'disconnect']) {
    const f = fixture(); f.h.sendMessage('old'); f.h[action](); f.open(); f.expire();
    assert.deepEqual(f.sent, []); assert.equal(f.h._isStreaming, false); assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
  }
});
test('reconnect deadline releases guard and cannot send expired turn', () => {
  const f = fixture(); f.h.sendMessage('old'); f.expire(); f.open();
  assert.equal(f.h._isStreaming, false); assert.deepEqual(f.sent, []); assert.equal(f.errors.length, 1);
  f.h.sendMessage('new'); assert.deepEqual(f.sent, ['new']);
});
test('synchronous connection and rollback guard preserve single-send behaviour', () => {
  const f = fixture(); f.h.connect = () => f.open(); f.h.sendMessage('now');
  assert.deepEqual(f.sent, ['now']); assert.equal(f.listeners.size, 0);
  const g = fixture(); g.h._isReverting = true; g.h.sendMessage('blocked'); assert.deepEqual(g.enqueued, []);
});
