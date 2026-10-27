'use strict';
// Runs the actual production host in isolated child processes. No GUI, user
// profile, real credential backend or provider endpoint is touched.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fork}=require('node:child_process'),{once}=require('node:events');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sc-host-behavior-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const host=path.join(root,'host');fs.mkdirSync(host);
  for(const file of fs.readdirSync(__dirname).filter(n=>n.endsWith('.cjs')&&!n.endsWith('.test.cjs')))fs.copyFileSync(path.join(__dirname,file),path.join(host,file));
  return {root,host,home:path.join(root,'profile'),extension:path.join(root,'extension'),folders:[path.join(root,'a'),path.join(root,'b')]};
}
function extension(f,id='sc-smoke.compat') {
  fs.mkdirSync(f.extension,{recursive:true});const dot=id.indexOf('.');
  fs.writeFileSync(path.join(f.extension,'package.json'),JSON.stringify({publisher:id.slice(0,dot),name:id.slice(dot+1),version:'1.0.0',engines:{vscode:'^1.110.0'},main:'./extension.cjs',activationEvents:['*']}));
  fs.writeFileSync(path.join(f.extension,'extension.cjs'),`const vscode=require('vscode');
exports.activate=async c=>{
const oldGlobal=c.globalState.get('count',0),oldWorkspace=c.workspaceState.get('count',0);
await c.globalState.update('count',oldGlobal+1);await c.workspaceState.update('count',oldWorkspace+1);
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.status',()=>({marker:vscode.workspace.getConfiguration('scSmoke').get('marker'),fontSize:vscode.workspace.getConfiguration('editor').get('fontSize'),oldGlobal,oldWorkspace,app:vscode.env.appName,mode:c.extensionMode,storage:c.storagePath,global:c.globalStoragePath})));
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.secret',()=>c.secrets.store('token','synthetic-secret')));
c.subscriptions.push(vscode.window.registerTreeDataProvider('scSmoke.tree',{getChildren:()=>[new vscode.TreeItem('Config: '+vscode.workspace.getConfiguration('scSmoke').get('marker'))],getTreeItem:item=>item}));
};`);
}
async function start(t,f,extraEnv={}) {
  const child=fork(path.join(f.host,'host.cjs'),[],{silent:true,env:{PATH:process.env.PATH||process.env.Path,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,SC_CODE_HOME:f.home,SC_CODE_EXTENSION_HOST:'true',SC_CODE_INIT_DATA:JSON.stringify({extensions:[{extensionLocation:{path:f.extension.replaceAll('\\','/')}}]}),...extraEnv}});
  let seq=0,stderr='',secretFail=false;const pending=new Map(),dialogResults=new Map(),events=[];child.stderr.on('data',b=>stderr+=b);
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  child.on('error',readyReject);child.on('exit',code=>{readyReject(Error('host exited '+code+': '+stderr));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('host exited'));}pending.clear();});
  child.on('message',msg=>{
    if(msg.type==='VSCODE_EXTHOST_IPC_READY')readyResolve();
    if(msg.event){events.push(msg.event);if(dialogResults.has(msg.event.type))child.send({type:'messageResponse',params:{requestId:msg.event.id,value:dialogResults.get(msg.event.type)}});}
    if(msg.event?.type==='extensionSecretRequest') {
      const event=msg.event;assert.equal(event.extensionId,'sc-smoke.compat');assert.equal(event.operation,'store');
      child.send({type:'extensionSecretResult',params:{reqId:event.reqId,result:null,error:secretFail?'synthetic keyring failure':undefined}});
    }
    const reply=msg.reply||msg.event,p=reply&&pending.get(reply.id);
    if(p){pending.delete(reply.id);clearTimeout(p.timer);reply.error?p.reject(Error(reply.error)):p.resolve(reply.result);}
  });
  const stop=async()=>{if(child.exitCode===null && child.signalCode===null){const exited=once(child,'exit');child.kill();await exited;}};
  t.after(stop);
  await Promise.race([ready,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('host ready timeout: '+stderr)),5000);timer.unref();})]);
  const request=(type,params)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(type+' timeout: '+stderr));},5000);pending.set(id,{resolve,reject,timer});child.send({id,type,params});});
  return {request,stop,events,setSecretFailure:v=>secretFail=v,setDialogResult:(type,value)=>dialogResults.set(type,value)};
}
async function configure(host,f){
  await host.request('initialize',{workspaceFolders:f.folders});
  await host.request('setConfiguration',{settings:{'scSmoke.marker':'migrated-custom-setting','editor.fontSize':17}});
  await host.request('releaseExtensionActivation');
  await host.request('activateExtension',{extensionId:'sc-smoke.compat'});
}
test('real host activates config/tree, persists state on restart, isolates workspace and bridges secret failures',{timeout:20000},async t=>{
  const f=fixture(t);extension(f);
  const legacy=path.join(f.extension,'.global-storage');fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'legacy.txt'),'old-data');
  const first=await start(t,f);await configure(first,f);
  const a=await first.request('executeCommand',{command:'scSmoke.status',args:[]});
  assert.equal(a.marker,'migrated-custom-setting');assert.equal(a.fontSize,17);assert.equal(a.app,'ScCode');assert.equal(a.mode,1);assert.equal(a.oldGlobal,0);assert.equal(a.oldWorkspace,0);
  assert.ok(a.global.startsWith(f.home));assert.ok(a.storage.startsWith(f.home));assert.equal(fs.readFileSync(path.join(a.global,'legacy.txt'),'utf8'),'old-data');
  const tree=await first.request('getTreeChildren',{viewId:'scSmoke.tree'});assert.equal(tree[0].label.label,'Config: migrated-custom-setting');
  await first.request('executeCommand',{command:'scSmoke.secret',args:[]});first.setSecretFailure(true);await assert.rejects(first.request('executeCommand',{command:'scSmoke.secret',args:[]}),/keyring failure/);
  await first.stop();const second=await start(t,f);await configure(second,f);const b=await second.request('executeCommand',{command:'scSmoke.status',args:[]});assert.equal(b.oldGlobal,1);assert.equal(b.oldWorkspace,1);await second.stop();
  f.folders=[f.folders[0]];const third=await start(t,f);await configure(third,f);const c=await third.request('executeCommand',{command:'scSmoke.status',args:[]});assert.equal(c.oldGlobal,2);assert.equal(c.oldWorkspace,0);assert.notEqual(a.storage,c.storage);
  await third.request('beginConfigurationSync'); f.folders=[f.folders[0],path.join(f.root,'different')];await configure(third,f);
  const d=await third.request('executeCommand',{command:'scSmoke.status',args:[]});assert.equal(d.oldGlobal,3);assert.equal(d.oldWorkspace,0);assert.notEqual(c.storage,d.storage);await third.stop();
  assert.deepEqual(fs.readdirSync(f.extension).sort(),['.global-storage','extension.cjs','package.json']);assert.deepEqual(fs.readdirSync(legacy),['legacy.txt']);
  assert.ok(!fs.existsSync(path.join(f.host,'node_modules')),'ESM shim must not write into install directory');
  function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(path.join(dir,e.name)):[path.join(dir,e.name)]);}
  for(const file of scan(f.home)) assert.ok(!fs.readFileSync(file,'utf8').includes('synthetic-secret'),'no plaintext secret persisted');
});
test('real preload no longer silently suppresses previously blacklisted extensions',{timeout:10000},async t=>{
  const f=fixture(t);extension(f,'GitHub.copilot');let host=await start(t,f);
  const list=await host.request('listExtensions');assert.ok(list.some(ext=>ext.id.toLowerCase()==='github.copilot'));await host.stop();
  host=await start(t,f,{SC_CODE_DISABLE_EXTENSION_IDS:' github.COPILOT '});assert.deepEqual(await host.request('listExtensions'),[]);
  await assert.rejects(host.request('loadExtension',{extensionPath:f.extension}),/explicitly disabled/);
  await host.request('initialize',{workspaceFolders:f.folders});await host.request('setConfiguration',{settings:{}});await host.request('releaseExtensionActivation');
  await assert.rejects(host.request('activateExtension',{extensionId:'GitHub.copilot'}),/explicitly disabled/);await host.stop();
});

test('real host round-trips custom open/save dialogs as URI objects and resolves cancellation',{timeout:10000},async t=>{
  const f=fixture(t);extension(f);
  fs.writeFileSync(path.join(f.extension,'extension.cjs'),`const vscode=require('vscode');
exports.activate=c=>{
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.open',async()=>{const picked=await vscode.window.showOpenDialog({canSelectFiles:true,canSelectFolders:true,canSelectMany:true});return {cancelled:picked===undefined,paths:picked?.map(u=>({fsPath:u.fsPath,scheme:u.scheme}))};}));
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.save',async()=>{const picked=await vscode.window.showSaveDialog({});return {cancelled:picked===undefined,fsPath:picked?.fsPath,scheme:picked?.scheme};}));
};`);
  const host=await start(t,f);await configure(host,f);
  const paths=[path.join(f.root,'folder with spaces','目录'),path.join(f.root,'file name.txt')];
  host.setDialogResult('showOpenDialog',paths);
  assert.deepEqual(await host.request('executeCommand',{command:'scSmoke.open',args:[]}),{cancelled:false,paths:paths.map(fsPath=>({fsPath,scheme:'file'}))});
  host.setDialogResult('showSaveDialog',paths[1]);
  assert.deepEqual(await host.request('executeCommand',{command:'scSmoke.save',args:[]}),{cancelled:false,fsPath:paths[1],scheme:'file'});
  host.setDialogResult('showOpenDialog',undefined);host.setDialogResult('showSaveDialog',undefined);
  assert.equal((await host.request('executeCommand',{command:'scSmoke.open',args:[]})).cancelled,true);
  assert.equal((await host.request('executeCommand',{command:'scSmoke.save',args:[]})).cancelled,true);
});

test('real CJS extension reload removes old commands and uses new code/tree providers',{timeout:10000},async t=>{
  const f=fixture(t);extension(f);
  const source=version=>`const vscode=require('vscode');
exports.activate=c=>{
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.version',()=>${JSON.stringify(version)}));
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.${version}',()=>${JSON.stringify(version)}));
c.subscriptions.push(vscode.window.registerTreeDataProvider('scSmoke.tree',{getChildren:()=>[new vscode.TreeItem(${JSON.stringify(version)})],getTreeItem:item=>item}));
};`;
  const main=path.join(f.extension,'extension.cjs');fs.writeFileSync(main,source('before'));
  const host=await start(t,f);await configure(host,f);
  assert.equal(await host.request('executeCommand',{command:'scSmoke.version',args:[]}),'before');
  assert.equal((await host.request('loadExtension',{extensionPath:f.extension})).alreadyActive,true);
  const nextMain=path.join(f.extension,'next.cjs');fs.writeFileSync(nextMain,source('after-update'));
  const manifestPath=path.join(f.extension,'package.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));manifest.main='./next.cjs';manifest.version='2.0.0';fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  assert.equal((await host.request('loadExtension',{extensionPath:f.extension})).reloaded,true);
  assert.ok(host.events.some(e=>e.type==='commandUnregistered'&&e.commandId==='scSmoke.before'));
  await host.request('activateExtension',{extensionId:'sc-smoke.compat'});
  assert.equal(await host.request('executeCommand',{command:'scSmoke.version',args:[]}),'after-update');
  assert.equal(await host.request('executeCommand',{command:'scSmoke.after-update',args:[]}),'after-update');
  await assert.rejects(host.request('executeCommand',{command:'scSmoke.before',args:[]}),/unknown command/i);
  assert.equal((await host.request('getTreeChildren',{viewId:'scSmoke.tree'}))[0].label.label,'after-update');
});
test('real ESM extension with top-level await resolves the profile shim in Unicode/spaced paths',{timeout:10000},async t=>{
  const f=fixture(t);f.home=path.join(f.root,'profile with spaces 中文');extension(f);
  const manifestPath=path.join(f.extension,'package.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));manifest.main='./extension.mjs';fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  fs.writeFileSync(path.join(f.extension,'extension.mjs'),`import { commands, env } from 'vscode';
await Promise.resolve();
export function activate(c){c.subscriptions.push(commands.registerCommand('scSmoke.esm',()=>({app:env.appName,mode:c.extensionMode,global:c.globalStoragePath})));}`);
  const host=await start(t,f);await configure(host,f);
  const result=await host.request('executeCommand',{command:'scSmoke.esm',args:[]});
  assert.equal(result.app,'ScCode');assert.equal(result.mode,1);assert.ok(result.global.startsWith(f.home));
  assert.ok(fs.existsSync(path.join(f.home,'runtime/extension-host/node_modules/vscode/index.mjs')));
  assert.ok(!fs.existsSync(path.join(f.host,'node_modules')));
});test('extension messages surface as one notification event and button choices round-trip',{timeout:10000},async t=>{
  const f=fixture(t);extension(f);
  fs.writeFileSync(path.join(f.extension,'extension.cjs'),`const vscode=require('vscode');
exports.activate=c=>{
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.plain',()=>vscode.window.showInformationMessage('plain-message')));
c.subscriptions.push(vscode.commands.registerCommand('scSmoke.choice',()=>vscode.window.showWarningMessage('choice-message','A','B')));
};`);
  const host=await start(t,f);await configure(host,f);
  await host.request('executeCommand',{command:'scSmoke.plain',args:[]});
  assert.equal(host.events.filter(e=>e.type==='showMessage'&&e.message==='plain-message').length,1);
  host.setDialogResult('showMessageRequest','B');
  assert.equal(await host.request('executeCommand',{command:'scSmoke.choice',args:[]}),'B');
  assert.equal(host.events.filter(e=>e.type==='showMessage'&&e.message==='choice-message').length,0);
  assert.equal(host.events.filter(e=>e.type==='showMessageRequest'&&e.message==='choice-message').length,1);
});
