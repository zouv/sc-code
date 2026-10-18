'use strict';
const fs = require('node:fs'), path = require('node:path');
const { root, runtime, runtimeConfig, run, serverSourceHash, sha256, treeHash, files, validateExtensions, copyHostModules, assertPrepared } = require('./desktop-runtime.cjs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const lock = JSON.parse(fs.readFileSync(path.join(__dirname,'runtime-lock.json'),'utf8'));
async function download(spec, target) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if (fs.existsSync(target) && sha256(target) === spec.sha256) return;
  console.log(`Downloading pinned resource: ${spec.url}`);
  const response = await fetch(spec.url); if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(target+'.partial'));
  if (sha256(target+'.partial') !== spec.sha256) throw new Error(`Checksum mismatch: ${target}`);
  fs.renameSync(target+'.partial',target);
}
function expand(archive, target) {
  if (fs.existsSync(path.join(target,'.extracted'))) return;
  fs.mkdirSync(target,{recursive:true});
  const quote = value => "'"+value.replaceAll("'","''")+"'";
  run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(target)} -Force`]);
  fs.writeFileSync(path.join(target,'.extracted'),'ok');
}
function buildServer() {
  const localGo = path.join(root,'.runtime/tools/go/bin/go.exe');
  const go = process.env.SC_CODE_GO_BINARY || (fs.existsSync(localGo) ? localGo : 'go');
  const zig = path.join(root,'.runtime/tools/zig-x86_64-windows-0.15.2/zig.exe');
  const env = { ...process.env, CGO_ENABLED:'1' };
  // Windows environment names are case-insensitive. Node spawn sorts duplicate
  // PATH/Path keys, so retaining both can discard the system executable search path.
  const originalPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = originalPath;
  const llvmBin = path.join(root,'.runtime/tools/llvm-mingw-20261006-ucrt-x86_64/bin');
  if (!env.CC && fs.existsSync(path.join(llvmBin,'gcc.exe'))) {
    env.CC = path.join(llvmBin,'gcc.exe');
    env.PATH = llvmBin + path.delimiter + (env.PATH || '');
  }
  if (!env.CC && fs.existsSync(zig)) env.CC = `"${zig}" cc -target x86_64-windows-gnu`;
  const output = path.join(runtime,process.platform === 'win32' ? 'sidex-server.exe' : 'sidex-server');
  fs.mkdirSync(runtime,{recursive:true});
  if (process.argv.includes('--test-go')) run(go,['test','-tags','fts5','./...'],{cwd:path.join(root,'sidexai/sidex-server'),env});
  run(go,['build','-trimpath','-tags','fts5','-o',output,'./cmd/server'],{cwd:path.join(root,'sidexai/sidex-server'),env});
  return output;
}
async function main() {
  if (process.argv.includes('--server-only')) { buildServer(); return; }
  if (`${process.platform}-${process.arch}` !== lock.platform) throw new Error('Pinned runtime preparation currently supports Windows x64 only; other platforms must add reviewed locks first.');
  const cache = path.join(root,'.runtime/downloads');
  const nodeArchive = path.join(cache,'node-'+lock.node.version+'.zip'), extArchive = path.join(cache,'vscodium-'+lock.extensions.version+'.zip');
  await Promise.all([download(lock.node,nodeArchive),download(lock.extensions,extArchive)]);
  const nodeRoot=path.join(cache,'node-'+lock.node.version), extRoot=path.join(cache,'vscodium-'+lock.extensions.version);
  expand(nodeArchive,nodeRoot); expand(extArchive,extRoot);
  const nodeDir = path.join(nodeRoot,`node-v${lock.node.version}-win-x64`);
  const builtins = path.join(extRoot,'resources/app/extensions');
  const descriptors=validateExtensions(builtins);
  fs.mkdirSync(path.join(runtime,'bin'),{recursive:true});
  fs.copyFileSync(path.join(nodeDir,'node.exe'),path.join(runtime,'bin/node.exe'));
  for (const target of [path.join(runtime,'extensions')]) {
    const resolved = path.resolve(target);
    if (![path.resolve(runtime,'extensions')].includes(resolved) || !resolved.startsWith(root+path.sep)) throw new Error('Unsafe generated extension destination');
    if (fs.existsSync(resolved)) fs.rmSync(resolved,{recursive:true,force:true});
    fs.cpSync(builtins,resolved,{recursive:true});
  }
  fs.mkdirSync(path.join(runtime,'licenses'),{recursive:true});
  fs.copyFileSync(path.join(nodeDir,'LICENSE'),path.join(runtime,'licenses/Node-LICENSE'));
  for (const name of ['LICENSE.txt','ThirdPartyNotices.txt']) {
    const file=path.join(extRoot,'resources/app',name);
    if (!fs.existsSync(file)) throw new Error(`Missing VSCodium source notices: ${name}`);
    fs.copyFileSync(file,path.join(runtime,'licenses','VSCodium-'+name));
  }
  copyHostModules(path.join(root,'src-tauri/extension-host'),path.join(runtime,'extension-host'));
  const server=buildServer();
  const resources={};
  for(const directory of ['bin','licenses','extension-host']) for(const file of files(path.join(runtime,directory))) resources[path.relative(root,file).replaceAll('\\','/')]=sha256(file);
  resources[path.relative(root,server).replaceAll('\\','/')]=sha256(server);
  const manifest={ platform:lock.platform, nodeVersion:lock.node.version, builtinVersion:lock.extensions.version, builtinCount:descriptors.length, builtinDescriptors:descriptors, serverSourceHash:serverSourceHash(), hostSourceHash:treeHash(path.join(root,'src-tauri/extension-host'),f=>f.endsWith('.cjs')&&!f.endsWith('.test.cjs')), extensionsHash:treeHash(path.join(runtime,'extensions')), resources };
  fs.writeFileSync(path.join(runtime,'manifest.json'),JSON.stringify(manifest,null,2));
  const resourcesMap = {};
  for (const [source, destination] of Object.entries({
    'bin/':'bin/', 'extensions/':'extensions/', 'extension-host/':'extension-host/',
    'licenses/':'licenses/', 'sidex-server.exe':'sidex-server.exe', 'manifest.json':'runtime-manifest.json',
  })) resourcesMap[path.join(runtime,source).replaceAll('\\','/')] = destination;
  fs.writeFileSync(runtimeConfig,JSON.stringify({bundle:{resources:resourcesMap}},null,2));
  assertPrepared();
}
main().catch(e=>{console.error(e.stack || e);process.exitCode=1;});
