'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.runtime/desktop');
const runtimeConfig = path.join(root, '.runtime/tauri.runtime.conf.json');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(`${command} exited ${result.status ?? result.signal}`), { exitCode: result.status || 1 });
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error(`Symlink not allowed in bundle: ${path.join(directory, e.name)}`);
    return e.isDirectory() ? files(path.join(directory,e.name)) : [path.join(directory,e.name)];
  });
}
function treeHash(directory, predicate = () => true) {
  const h = crypto.createHash('sha256');
  for (const file of files(directory).filter(predicate)) { h.update(path.relative(directory,file).replaceAll('\\','/')); h.update('\0'); h.update(fs.readFileSync(file)); h.update('\0'); }
  return h.digest('hex');
}
function validateExtensions(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const base = path.join(directory, entry.name), pkgPath = path.join(base, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!pkg.name || !pkg.version || !pkg.engines?.vscode) throw new Error(`Invalid extension manifest: ${entry.name}`);
    // Desktop distributions may declare a browser build that is not shipped.
    // Main is authoritative for our Node host; browser-only extensions must be compiled.
    for (const field of pkg.main ? ['main'] : ['browser']) {
      if (!pkg[field]) continue;
      const resolved = path.resolve(base,pkg[field]);
      if (!resolved.startsWith(base + path.sep)) throw new Error(`Entrypoint escapes extension: ${entry.name}`);
      if (![resolved,resolved+'.js',path.join(resolved,'index.js')].some(f => fs.existsSync(f) && fs.statSync(f).isFile())) throw new Error(`Uncompiled/missing ${field}: ${entry.name} (${pkg[field]})`);
    }
    result.push({ id: `${pkg.publisher || 'vscode'}.${pkg.name}`, version: pkg.version, main: pkg.main, browser: pkg.browser });
  }
  for (const required of ['vscode.json','vscode.typescript','vscode.git']) if (!result.some(e => e.id === required)) throw new Error(`Missing core builtin ${required}`);
  return result.sort((a,b) => a.id.localeCompare(b.id));
}
function copyHostModules(source, target) {
  fs.mkdirSync(target, { recursive: true });
  const names = fs.readdirSync(source).filter(f => f.endsWith('.cjs') && !f.endsWith('.test.cjs'));
  for (const old of fs.readdirSync(target)) if (!names.includes(old)) fs.rmSync(path.join(target,old), { recursive: true, force: true });
  for (const name of names) fs.copyFileSync(path.join(source,name),path.join(target,name));
  return names;
}
function serverSourceHash() { return treeHash(path.join(root,'agent/server'), f => /\.(go|mod|sum)$/.test(f)); }
function assertPrepared() {
  const marker = path.join(runtime,'manifest.json');
  if (!fs.existsSync(marker)) throw new Error('Runtime not prepared. Run npm run runtime:prepare (Windows x64 with Go + a C compiler).');
  if (!fs.existsSync(runtimeConfig)) throw new Error('Runtime overlay missing: rerun npm run runtime:prepare');
  const m = JSON.parse(fs.readFileSync(marker,'utf8'));
  if (m.platform !== `${process.platform}-${process.arch}`) throw new Error('Runtime prepared for another platform');
  if (serverSourceHash() !== m.serverSourceHash) throw new Error('Go sources changed: rerun npm run runtime:prepare');
  for (const [relative,hash] of Object.entries(m.resources)) {
    const file = path.resolve(root,relative);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || sha256(file) !== hash) throw new Error(`Missing/stale runtime resource: ${relative}`);
  }
  if (treeHash(path.join(runtime,'extensions')) !== m.extensionsHash) throw new Error('Builtin extensions changed: rerun preparation');
  if (treeHash(path.join(root,'src-tauri/extension-host'), f => f.endsWith('.cjs') && !f.endsWith('.test.cjs')) !== m.hostSourceHash) throw new Error('Extension host changed: rerun preparation');
  validateExtensions(path.join(runtime,'extensions'));
  console.log(`Runtime preflight passed: ${m.builtinCount} builtins, authenticated host, Node ${m.nodeVersion}, native agent.`);
  return m;
}
module.exports = { root, runtime, runtimeConfig, run, sha256, files, treeHash, validateExtensions, copyHostModules, serverSourceHash, assertPrepared };
if (require.main === module) { try { assertPrepared(); } catch(e) { console.error(e.message); process.exitCode=1; } }
