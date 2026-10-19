'use strict';
// Only finished Windows packages leave .runtime; no build caches or staging files.
const fs = require('node:fs');
const path = require('node:path');

function assertLocalPath(base, file) {
  const root = fs.realpathSync(base);
  const absolute = path.resolve(file);
  if (!absolute.startsWith(root + path.sep)) throw new Error(`Package path escapes project: ${absolute}`);
  for (let check = absolute; check !== root; check = path.dirname(check)) {
    let stat;
    try { stat = fs.lstatSync(check); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Refusing package path link: ${check}`);
  }
  return absolute;
}
function buildPaths(args, base) {
  const root = fs.realpathSync(base);
  const tauriArgs = args.slice(0, args.includes('--') ? args.indexOf('--') : args.length);
  let target;
  for (let i = 0; i < tauriArgs.length; i++) {
    const arg = tauriArgs[i];
    if (arg === '--target' || arg === '-t') {
      target = tauriArgs[++i];
      if (!target || target.startsWith('-')) throw new Error('Missing build target');
    } else if (arg.startsWith('--target=')) target = arg.slice('--target='.length);
  }
  if (target !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(target)) throw new Error(`Invalid build target: ${target}`);
  const mode = tauriArgs.some(arg => arg === '--debug' || arg === '-d') ? 'Debug' : 'Release';
  const profile = mode.toLowerCase();
  const targetRoot = path.join(root, '.runtime/target');
  const build = path.join(targetRoot, ...(target ? [target] : []), profile);
  return { mode, targetRoot, build, bundle: path.join(build, 'bundle'), packages: path.join(root, 'packages', mode === 'Debug' ? 'dev' : 'release') };
}
function installerSnapshot(base, bundle) {
  assertLocalPath(base, bundle);
  const result = new Map();
  for (const [format, pattern] of [['nsis', /\.exe(?:\.sig)?$/i], ['msi', /\.msi(?:\.sig)?$/i]]) {
    const folder = assertLocalPath(base, path.join(bundle, format));
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!pattern.test(entry.name)) continue;
      const file = assertLocalPath(base, path.join(folder, entry.name));
      const stat = fs.statSync(file, { bigint: true });
      if (stat.isFile()) result.set(file, [stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':'));
    }
  }
  return result;
}
function freshInstallers(base, paths, before) {
  const fresh = [...installerSnapshot(base, paths.bundle)].filter(([file, stamp]) => before.get(file) !== stamp).map(([file]) => file);
  if (!fresh.some(file => /\.(exe|msi)$/i.test(file))) throw new Error(`No new installer produced in ${paths.bundle}; old packages were not exported.`);
  return fresh;
}
function exportPackages(base, paths, before) {
  const fresh = freshInstallers(base, paths, before);
  const destination = assertLocalPath(base, paths.packages);
  const outputs = fresh.map(source => ({ source, output: assertLocalPath(base, path.join(destination, path.basename(source))) }));
  if (new Set(outputs.map(({ output }) => output.toLowerCase())).size !== outputs.length) throw new Error('Installer filenames collide');
  // Validate every destination and its temporary sibling before touching any output.
  for (const { output } of outputs) assertLocalPath(base, output + '.partial');
  fs.mkdirSync(destination, { recursive: true });
  for (const { source, output } of outputs) {
    fs.copyFileSync(source, output + '.partial');
    fs.renameSync(output + '.partial', output);
    console.log(`[PACKAGE] ${output}`);
  }
  return outputs.map(({ output }) => output);
}
module.exports = { assertLocalPath, buildPaths, installerSnapshot, freshInstallers, exportPackages };
