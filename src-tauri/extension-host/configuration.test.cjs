'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { ActivationGate, ConfigurationStore, createWorkspaceConfiguration } = require('./configuration.cjs');

test('Workbench values override manifest defaults and preserve special values', () => {
  const store = new ConfigurationStore();
  store.setDefault('vac.agents', { Default: { kind: 'claude' } });
  store.setDefault('vac.customModels', []);
  store.replaceWorkbench({
    'vac.agents': { 'Claude Code': { kind: 'claude' }, 'Codex CLI': { kind: 'codex' } },
    'vac.customModels': [{ name: 'Model', modelId: 'model-1' }],
    'test.false': false,
    'test.zero': 0,
    'test.empty': '',
    'test.null': null,
  });

  assert.deepEqual(Object.keys(store.get('vac.agents')), ['Claude Code', 'Codex CLI']);
  assert.deepEqual(store.get('vac.customModels'), [{ name: 'Model', modelId: 'model-1' }]);
  assert.equal(store.get('test.false'), false);
  assert.equal(store.get('test.zero'), 0);
  assert.equal(store.get('test.empty'), '');
  assert.equal(store.get('test.null'), null);
});

test('configuration snapshots replace prior values and fall back to defaults on removal', () => {
  const store = new ConfigurationStore();
  store.setDefault('vac.agents', { Default: true });
  store.setDefault('vac.customModels', []);
  store.replaceWorkbench({ 'vac.agents': { Custom: true }, 'vac.customModels': [{ modelId: 'custom' }] });

  const changed = store.replaceWorkbench({ 'vac.agents': { Updated: true } });

  assert.deepEqual(store.get('vac.agents'), { Updated: true });
  assert.deepEqual(store.get('vac.customModels'), []);
  assert.ok(changed.includes('vac.customModels'));
  store.replaceWorkbench({});
  assert.deepEqual(store.get('vac.agents'), { Default: true });
});

test('snapshot changes notify additions, updates and removals only', () => {
  const events = [];
  const store = new ConfigurationStore((keys) => events.push(keys));
  store.replaceWorkbench({ 'vac.agents': { A: true }, 'vac.customModels': [] });
  store.replaceWorkbench({ 'vac.agents': { B: true }, 'vac.customModels': [], 'test.enabled': true });

  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events[1]), new Set(['vac.agents', 'test.enabled']));
  store.replaceWorkbench({ 'vac.agents': { B: true }, 'vac.customModels': [], 'test.enabled': true });
  assert.equal(events.length, 2);
});

test('a changed Workbench key discards a conflicting runtime update', async () => {
  const store = new ConfigurationStore();
  const config = createWorkspaceConfiguration(store, 'vac');
  await config.update('enabled', false);
  assert.equal(config.get('enabled'), false);
  store.replaceWorkbench({ 'vac.enabled': true });
  assert.equal(config.get('enabled'), true);
});

test('workspace configuration supports nested sections, dotted keys and has', () => {
  const store = new ConfigurationStore();
  store.replaceWorkbench({
    'vac.agents': { 'Claude Code': { command: 'npx' } },
    'vac.customModels': [{ modelId: 'model-1' }],
    'vac.dashboard.enabled': false,
  });
  const vac = createWorkspaceConfiguration(store, 'vac');
  const all = createWorkspaceConfiguration(store);

  assert.deepEqual(vac.get('agents'), { 'Claude Code': { command: 'npx' } });
  assert.deepEqual(vac.get('customModels'), [{ modelId: 'model-1' }]);
  assert.equal(vac.get('dashboard.enabled'), false);
  assert.deepEqual(all.get('vac.agents'), { 'Claude Code': { command: 'npx' } });
  assert.deepEqual(vac.get(), {
    agents: { 'Claude Code': { command: 'npx' } },
    customModels: [{ modelId: 'model-1' }],
    dashboard: { enabled: false },
  });
  assert.equal(vac.has('agents'), true);
  assert.equal(vac.has('missing'), false);
});

test('configuration.update values are overridden by Workbench and reappear after removal', async () => {
  const store = new ConfigurationStore();
  store.setDefault('vac.enabled', true);
  const config = createWorkspaceConfiguration(store, 'vac');
  await config.update('enabled', false);
  assert.equal(config.get('enabled'), false);
  store.replaceWorkbench({ 'vac.enabled': true });
  assert.equal(config.get('enabled'), true);
  store.replaceWorkbench({});
  assert.equal(config.get('enabled'), true);
});

test('activation gate blocks until configuration is acknowledged', async () => {
  const gate = new ActivationGate();
  let activated = false;
  const activation = gate.wait().then(() => { activated = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activated, false);
  gate.open();
  await activation;
  assert.equal(activated, true);
  gate.close();
  assert.equal(gate.isOpen, false);
  const reconnectActivation = gate.wait().then(() => { activated = 'reconnected'; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activated, true);
  gate.open();
  await reconnectActivation;
  assert.equal(activated, 'reconnected');
});

test('activation gate can be shared by automatic and explicit activation paths', async () => {
  const gate = new ActivationGate();
  const activationOrder = [];
  const autoActivation = gate.wait().then(() => activationOrder.push('auto'));
  const explicitActivation = gate.wait().then(() => activationOrder.push('explicit'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(activationOrder, []);
  gate.open();
  await Promise.all([autoActivation, explicitActivation]);
  assert.deepEqual(activationOrder, ['auto', 'explicit']);
  gate.close();
  const reconnected = gate.wait();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.isOpen, false);
  gate.open();
  await reconnected;
});

test('host defers auto-activation until the Workbench snapshot is applied and released', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-code-config-host-'));
  const extensionDir = path.join(temp, 'extension');
  const initDataPath = path.join(temp, 'init.json');
  const resultPath = path.join(temp, 'activated-config.json');
  fs.mkdirSync(extensionDir);
  fs.writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify({
    name: 'config-probe',
    publisher: 'sc-code-test',
    version: '1.0.0',
    main: 'extension.js',
    activationEvents: [],
    contributes: { configuration: { properties: {
      'vac.agents': { type: 'object', default: { Default: true } },
      'vac.customModels': { type: 'array', default: [] },
    } } },
  }));
  fs.writeFileSync(path.join(extensionDir, 'extension.js'), [
    "const fs = require('node:fs');",
    "const vscode = require('vscode');",
    'exports.activate = () => {',
    "  const config = vscode.workspace.getConfiguration('vac');",
    `  fs.writeFileSync(process.env.SC_CODE_TEST_CONFIG_RESULT, JSON.stringify({ agents: config.get('agents'), models: config.get('customModels') }));`,
    '};',
  ].join('\n'));
  fs.writeFileSync(initDataPath, JSON.stringify({ extensions: [{ extensionLocation: { path: extensionDir } }] }));

  const child = fork(path.join(__dirname, 'host.cjs'), ['--type=extensionHost'], {
    silent: true,
    env: { ...process.env, SC_CODE_EXTENSION_HOST: 'true', SC_CODE_INIT_DATA_FILE: initDataPath, SC_CODE_TEST_CONFIG_RESULT: resultPath },
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });

  let nextId = 1;
  const request = (type, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 10000);
    const listener = (message) => {
      if (message?.type !== 'sc-code:host-reply' || message.reply?.id !== id) return;
      clearTimeout(timeout);
      child.off('message', listener);
      if (message.reply.error) reject(new Error(message.reply.error));
      else resolve(message.reply.result);
    };
    child.on('message', listener);
    child.send({ id, type, params }, error => { if (error) console.error('SEND ERROR', error); });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('host startup timed out')), 10000);
    const listener = (message) => {
      if (message?.type !== 'VSCODE_EXTHOST_IPC_READY') return;
      clearTimeout(timeout);
      child.off('message', listener);
      resolve();
    };
    child.on('message', listener);
    child.once('error', reject);
  });

  await assert.rejects(request('activateExtension', { extensionId: 'sc-code-test.config-probe' }), /before the initial configuration snapshot/);
  const settings = {
    'vac.agents': { 'Claude Code': { command: 'npx' }, 'Codex CLI': { command: 'codex' } },
    'vac.customModels': [{ name: 'Model A', modelId: 'model-a' }, { name: 'Model B', modelId: 'model-b' }],
  };
  assert.equal((await request('setConfiguration', { settings })).applied, true);
  assert.equal(fs.existsSync(resultPath), false);
  assert.equal(await request('releaseExtensionActivation', {}), true);
  assert.deepEqual(await request('activateExtension', { extensionId: 'sc-code-test.config-probe' }), { activated: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, 'utf8')), {
    agents: settings['vac.agents'],
    models: settings['vac.customModels'],
  });

  await request('deactivateExtension', { extensionId: 'sc-code-test.config-probe' });
  await request('beginConfigurationSync', {});
  assert.deepEqual(await request('activateExtension', { extensionId: 'sc-code-test.config-probe' }), { activated: false, deferred: true });
  const updatedSettings = { 'vac.agents': { Updated: { command: 'codex' } }, 'vac.customModels': [] };
  assert.equal((await request('setConfiguration', { settings: updatedSettings })).applied, true);
  assert.equal(await request('releaseExtensionActivation', {}), true);
  assert.deepEqual(await request('activateExtension', { extensionId: 'sc-code-test.config-probe' }), { activated: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, 'utf8')), {
    agents: updatedSettings['vac.agents'],
    models: updatedSettings['vac.customModels'],
  });
});
