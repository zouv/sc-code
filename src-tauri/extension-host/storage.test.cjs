'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createMemento, extensionStoragePaths, createSecretStorage, profileHome, disabledExtension } = require('./storage.cjs');
function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'sc-state-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root; }
test('memento persists JSON values, null and deletes undefined on restart', async t => {
  const root=fixture(t), file=path.join(root,'state.json'), state=createMemento(file);
  const value={nested:[1,2]}; await state.update('key',value); value.nested.push(3);
  await state.update('nil',null); await state.update('__proto__',{pollution:true});
  const restarted=createMemento(file); assert.deepEqual(restarted.get('key'),{nested:[1,2]}); assert.equal(restarted.get('nil','fallback'),null);
  assert.equal({}.pollution,undefined); assert.deepEqual(restarted.get('__proto__'),{pollution:true});
  await restarted.update('key',undefined); assert.equal(createMemento(file).get('key','missing'),'missing');
  assert.deepEqual(fs.readdirSync(root),['state.json']);
});
test('concurrent instances merge different keys and local updates are serialized', async t=>{
  const file=path.join(fixture(t),'state.json'); const a=createMemento(file), b=createMemento(file);
  await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).update('k'+i,i)));
  assert.equal(createMemento(file).keys().length,20);
  await Promise.all([a.update('ordered',1),a.update('ordered',2)]); assert.equal(createMemento(file).get('ordered'),2);
});
test('invalid JSON is preserved, failed save does not mutate memory', async t=>{
  const file=path.join(fixture(t),'state.json'); fs.writeFileSync(file,'{'); assert.throws(()=>createMemento(file)); assert.equal(fs.readFileSync(file,'utf8'),'{');
  fs.unlinkSync(file); const state=createMemento(file); await state.update('key',1); fs.unlinkSync(file); fs.mkdirSync(file);
  await assert.rejects(state.update('key',2)); assert.equal(state.get('key'),1); assert.ok(!fs.existsSync(file+'.lock'));
});
test('non-JSON values reject without losing previously committed state', async t=>{
  const state=createMemento(path.join(fixture(t),'state.json')); const cyclic={};cyclic.self=cyclic;
  await state.update('ok',1); await assert.rejects(state.update('bad',cyclic)); await assert.rejects(state.update('bad',1n)); assert.deepEqual(state.keys(),['ok']);
  await state.update('later',2);assert.equal(state.get('later'),2);
});
test('storage paths separate profiles, extension IDs and multi-root workspaces',t=>{
  const root=fixture(t),env={SC_CODE_HOME:path.join(root,'profile-a')},folders=[path.join(root,'a'),path.join(root,'b')];
  const a=extensionStoragePaths('SC-SMOKE.One',folders,undefined,env),b=extensionStoragePaths('sc-smoke.one',[folders[0]],undefined,env);
  assert.equal(a.global,b.global);assert.notEqual(a.workspace,b.workspace);
  assert.notEqual(a.global,extensionStoragePaths('sc-smoke.two',folders,undefined,env).global);
  assert.notEqual(a.global,extensionStoragePaths('sc-smoke.one',folders,undefined,{SC_CODE_HOME:path.join(root,'profile-b')}).global);
  assert.notEqual(a.workspace,extensionStoragePaths('sc-smoke.one',folders,'file:///one.code-workspace',env).workspace);
  assert.equal(extensionStoragePaths('sc-smoke.one',[],undefined,env).workspace,undefined);
  assert.throws(()=>extensionStoragePaths('../escape',folders,undefined,env));
});
test('standard profile fallback and explicit disable list have no hidden blacklist',()=>{
  assert.equal(profileHome({APPDATA:'C:/Roaming'},'win32','C:/User'),path.join('C:/Roaming','ScCode'));
  assert.equal(profileHome({XDG_CONFIG_HOME:'/config'},'linux','/home/test'),path.join('/config','ScCode'));
  for(const id of ['GitHub.copilot','sswg.swift-lang','anysphere.cursor','ms-python.vscode-pylance']) assert.equal(disabledExtension(id,{}),false);
  assert.equal(disabledExtension('GitHub.copilot',{SC_CODE_DISABLE_EXTENSION_IDS:' github.COPILOT,other.id '}),true);
  assert.equal(disabledExtension('GitHub.copilot',{SC_CODE_DISABLE_EXTENSION_IDS:''}),false);
});
test('secrets request native bridge, report changes only after success and never keep plaintext fallback',async()=>{
  const calls=[],listeners=[];let fail=false;
  const secret=createSecretStorage('SC-SMOKE.One',async(...args)=>{calls.push(args);if(fail)throw new Error('keyring unavailable');return args[1]==='get'?null:undefined;});
  const disposable=secret.onDidChange(event=>listeners.push(event.key));
  assert.equal(await secret.get('key'),undefined);await secret.store('key','synthetic');await secret.delete('key'); assert.deepEqual(listeners,['key','key']);
  assert.deepEqual(calls[1],['sc-smoke.one','store','key','synthetic']);fail=true;await assert.rejects(secret.store('key','synthetic'));assert.equal(listeners.length,2);
  disposable.dispose();fail=false;await secret.store('key','synthetic');assert.equal(listeners.length,2);
  await assert.rejects(secret.store('key',{}));await assert.rejects(secret.get(''));
});

test('legacy extension storage copies missing files without mutating either source or target data',t=>{
  const {migrateLegacyStorage}=require('./storage.cjs'); const root=fixture(t),extension=path.join(root,'extension'); fs.mkdirSync(extension);
  const legacy=path.join(extension,'.global-storage');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'same.txt'),'old');fs.writeFileSync(path.join(legacy,'missing.txt'),'preserved');
  const paths=extensionStoragePaths('sample.one',[root],undefined,{SC_CODE_HOME:path.join(root,'profile')});fs.writeFileSync(path.join(paths.global,'same.txt'),'new');
  migrateLegacyStorage(extension,paths);assert.equal(fs.readFileSync(path.join(paths.global,'same.txt'),'utf8'),'new');assert.equal(fs.readFileSync(path.join(paths.global,'missing.txt'),'utf8'),'preserved');assert.equal(fs.readFileSync(path.join(legacy,'same.txt'),'utf8'),'old');
  fs.writeFileSync(path.join(legacy,'later.txt'),'not recopy');migrateLegacyStorage(extension,paths);assert.ok(!fs.existsSync(path.join(paths.global,'later.txt')));
});
