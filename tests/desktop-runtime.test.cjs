'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {validateExtensions,copyHostModules,treeHash}=require('../scripts/desktop-runtime.cjs');
function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'sc-runtime-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root; }
function builtins(root) {
 for(const name of ['json','typescript','git']) { const p=path.join(root,name);fs.mkdirSync(p);fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({name,publisher:'vscode',version:'1',engines:{vscode:'*'}})); }
}
test('desktop main entry is valid even when upstream web artifact is not shipped',t=>{
 const root=fixture(t);builtins(root);const p=path.join(root,'git');fs.writeFileSync(path.join(p,'main.js'),'module.exports={}');
 fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({name:'git',publisher:'vscode',version:'1',engines:{vscode:'*'},main:'./main',browser:'./missing-web.js'}));
 assert.equal(validateExtensions(root).length,3);
 fs.unlinkSync(path.join(p,'main.js'));assert.throws(()=>validateExtensions(root),/missing main/);
});
test('browser-only code and escaping main entrypoints are rejected before bundling',t=>{
 const root=fixture(t);builtins(root); const file=path.join(root,'json/package.json');
 fs.writeFileSync(file,JSON.stringify({name:'json',publisher:'vscode',version:'1',engines:{vscode:'*'},browser:'./missing'}));
 assert.throws(()=>validateExtensions(root),/missing browser/);
 fs.writeFileSync(file,JSON.stringify({name:'json',publisher:'vscode',version:'1',engines:{vscode:'*'},main:'../escape.js'}));assert.throws(()=>validateExtensions(root),/escapes/);
});
test('host bundle contains only production CJS and removes stale modules',t=>{
 const root=fixture(t), source=path.join(root,'source'),target=path.join(root,'target');fs.mkdirSync(source);fs.mkdirSync(target);
 fs.writeFileSync(path.join(source,'host.cjs'),'production');fs.writeFileSync(path.join(source,'host.test.cjs'),'test');fs.writeFileSync(path.join(target,'obsolete.cjs'),'stale');
 assert.deepEqual(copyHostModules(source,target),['host.cjs']);assert.deepEqual(fs.readdirSync(target),['host.cjs']);
 const hash=treeHash(target);fs.writeFileSync(path.join(target,'host.cjs'),'changed');assert.notEqual(treeHash(target),hash);
});
