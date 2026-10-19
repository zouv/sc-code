'use strict';
const path = require('node:path');
const { root, runtimeConfig, run, assertPrepared } = require('./desktop-runtime.cjs');
const { buildPaths, installerSnapshot, freshInstallers, exportPackages } = require('./package-output.cjs');
const { prepareUnpack, publishUnpack, archiveUnpack, removeStage } = require('./unpack-output.cjs');
function buildDesktop(args, { base = root, preflight = assertPrepared, runCommand = run } = {}) {
  const paths = buildPaths(args, base);
  const noBundle = args.includes('--no-bundle') || args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg));
  preflight();
  const before = noBundle ? undefined : installerSnapshot(base, paths.bundle);
  const env = { ...process.env, AWS_LC_SYS_PREBUILT_NASM: '1', CARGO_TARGET_DIR: paths.targetRoot };
  delete env.CC; delete env.CXX;
  runCommand(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', runtimeConfig, ...args], { env });
  if (!noBundle) {
    freshInstallers(base, paths, before); // Reject old installers before copying an unpack tree.
    const prepared = prepareUnpack(base, paths); // Validate all runtime resources before changing finished packages.
    try { exportPackages(base, paths, before); publishUnpack(prepared); archiveUnpack(base, paths); }
    finally { removeStage(base, prepared.stage); }
  }
  return paths;
}
module.exports = { buildDesktop };
if (require.main === module) {
  try { buildDesktop(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
