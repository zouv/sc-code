'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function fixture(fail = false, initialized = Promise.resolve()) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/sc-code/security/workspaceTrust.contribution.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const calls = [], exports = {}; let Contribution;
  const decorator = () => {};
  new Function('exports', 'require', js)(exports, id => {
    if (id === '@tauri-apps/api/core') { return { invoke: async (command, args) => { calls.push({ command, ...args }); if (fail) { throw new Error('synthetic bridge failure'); } } }; }
    if (id.endsWith('/lifecycle.js')) { return { Disposable: class { _register(value) { return value; } } }; }
    if (id.endsWith('/workspaceTrust.js')) { return { IWorkspaceTrustManagementService: decorator }; }
    if (id.endsWith('/log.js')) { return { ILogService: decorator }; }
    if (id.endsWith('/contributions.js')) { return { WorkbenchPhase: { BlockStartup: 1 }, registerWorkbenchContribution2: (_id, ctor) => { Contribution = ctor; } }; }
    throw new Error(id);
  });
  let participant;
  const trust = { workspaceResolved: Promise.resolve(), workspaceTrustInitialized: initialized, isWorkspaceTrusted: () => false, addWorkspaceTrustTransitionParticipant: value => { participant = value; return { dispose() {} }; } };
  new Contribution(trust, { warn() {}, error() {} });
  return { recover: exports.registerNativeExtensionHostRecovery, calls, ready: exports.whenNativeWorkspaceTrustReady, change: trusted => participant.participate(trusted) };
}
test('native trust starts restricted and serializes grants/revocations with session and revisions', async () => {
  globalThis.__SC_CODE_TAURI__ = true; globalThis.__SC_CODE_TRUST_SESSION__ = 'synthetic-session';
  try {
    const f = fixture(false, new Promise(() => {})); await f.ready; await f.change(true); await f.change(false);
    assert.deepEqual(f.calls, [false, true, false].map((trusted, index) => ({ command: 'workspace_set_trust', trusted, session: 'synthetic-session', revision: index + 1 })));
  } finally { delete globalThis.__SC_CODE_TAURI__; delete globalThis.__SC_CODE_TRUST_SESSION__; }
});
test('bridge errors do not prevent editor startup or fabricate an authorization', async () => {
  globalThis.__SC_CODE_TAURI__ = true;
  try { const f = fixture(true); await f.ready; assert.ok(f.calls.length >= 1); assert.ok(f.calls.every(call => call.trusted === false)); }
  finally { delete globalThis.__SC_CODE_TAURI__; }
});
test('browser preview never attempts native authorization', async () => {
  const f = fixture(); await f.ready; await f.change(true); assert.equal(f.calls.length, 0);
});

test('native readiness does not wait for remote authority final trust initialization', async () => {
  globalThis.__SC_CODE_TAURI__ = true;
  try {
    const f = fixture(false, new Promise(() => {}));
    await Promise.race([f.ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('resolver initialization deadlock')), 500); timer.unref(); })]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].trusted, false);
  } finally { delete globalThis.__SC_CODE_TAURI__; }
});

test('trust grant recreates a failed real host after extension registration', async () => {
  const f = fixture(); await f.ready;
  let listener, trusted = true, starts = 0;
  f.recover({ onDidChangeTrust(callback) { listener = callback; return { dispose() {} }; }, isWorkspaceTrusted: () => trusted }, { whenInstalledExtensionsRegistered: async () => {}, startExtensionHosts: async () => { starts++; } }, { error() {} }, () => true);
  listener(true); await new Promise(setImmediate); assert.equal(starts, 1);
  trusted = false; listener(false); await new Promise(setImmediate); assert.equal(starts, 1);
});
test('late registration cannot restart a revoked or superseded host generation', async () => {
  const f = fixture(); await f.ready;
  let listener, registered, trusted = true, starts = 0;
  const ready = new Promise(resolve => { registered = resolve; });
  f.recover({ onDidChangeTrust(callback) { listener = callback; return { dispose() {} }; }, isWorkspaceTrusted: () => trusted }, { whenInstalledExtensionsRegistered: () => ready, startExtensionHosts: async () => { starts++; } }, { error() {} }, () => true);
  listener(true); trusted = false; listener(false); registered();
  await new Promise(setImmediate); assert.equal(starts, 0);
  trusted = true; listener(true); listener(true);
  await new Promise(setImmediate); assert.equal(starts, 1);
});
