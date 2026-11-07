'use strict';
const path = require('node:path');
const { root, runtimeConfig, run, assertPrepared } = require('./desktop-runtime.cjs');

function cargoBuildArgs(args) {
  const result = ['build', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), '--no-default-features'];
  if (args.includes('--release') || args.includes('-r')) result.push('--release');
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--target' || args[i] === '-t') && args[i + 1]) {
      result.push('--target', args[i + 1]);
      i++;
    } else if (args[i].startsWith('--target=')) {
      result.push(args[i]);
    }
  }
  return result;
}

function devDesktop(args = process.argv.slice(2), { preflight = assertPrepared, runCommand = run } = {}) {
  const helpOnly = args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg));
  const env = { ...process.env, AWS_LC_SYS_PREBUILT_NASM: '1' };
  delete env.CC; delete env.CXX;
  if (!helpOnly) {
    console.log('[DEV] Step 1/2: Compiling ScCode before starting development mode...');
    runCommand(process.execPath, [path.join(root, 'scripts/build-ext-host.cjs')], { env });
    try {
      preflight();
    } catch (error) {
      console.log(`[PREPARE] ${error.message}`);
      runCommand(process.execPath, [path.join(root, 'scripts/prepare-desktop-runtime.cjs')], { env });
      preflight();
    }
    runCommand(process.execPath, [path.join(root, 'scripts/generate-extension-meta.js')], { env });
    runCommand('cargo', cargoBuildArgs(args), { env });
    console.log('[DEV] Step 2/2: Starting ScCode in development mode...');
  } else {
    preflight();
  }
  runCommand(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', runtimeConfig, ...args], { env });
}

module.exports = { devDesktop, cargoBuildArgs };
if (require.main === module) {
  try {
    devDesktop();
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
