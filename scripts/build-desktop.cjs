'use strict';
const path = require('node:path');
const { root, runtimeConfig, run, assertPrepared } = require('./desktop-runtime.cjs');
const { buildPaths, installerSnapshot, freshInstallers, exportPackages } = require('./package-output.cjs');
const { assertUnpackTargetReady, prepareUnpack, exportUnpacked, archiveUnpack, removeStage } = require('./unpack-output.cjs');
function buildDesktop(args, { base = root, preflight = assertPrepared, runCommand = run } = {}) {
  const paths = buildPaths(args, base);
  const noBundle = args.includes('--no-bundle') || args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg));
  preflight();
  // Fail before the expensive native build if packages/<mode>/unpack is held
  // open by a running ScCode instance.
  assertUnpackTargetReady(base, paths);
  const before = noBundle ? undefined : installerSnapshot(base, paths.bundle);
  const env = { ...process.env, AWS_LC_SYS_PREBUILT_NASM: '1', CARGO_TARGET_DIR: paths.targetRoot };
  delete env.CC; delete env.CXX;
  runCommand(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', runtimeConfig, ...args], { env });
  if (!noBundle) {
    const prepared = prepareUnpack(base, paths); // Validate all runtime resources before changing finished packages.
    try {
      // Release publishes both the NSIS installer and the unpack zip; Debug only publishes its unpack zip.
      if (paths.mode === 'Release') freshInstallers(base, paths, before); // Reject old installers before writing any finished package.
      // Publish the uncompressed folder first, then archive that exact tree.
      const unpack = exportUnpacked(base, paths, prepared.stage);
      archiveUnpack(base, paths, unpack);
      if (paths.mode === 'Release') exportPackages(base, paths, before);
    } finally { removeStage(base, prepared.stage); }
  }
  return paths;
}
module.exports = { buildDesktop };
if (require.main === module) {
  try { buildDesktop(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
