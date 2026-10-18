'use strict';
const path = require('node:path');
const { root, runtimeConfig, run, assertPrepared } = require('./desktop-runtime.cjs');
try {
  assertPrepared();
  const env = { ...process.env, AWS_LC_SYS_PREBUILT_NASM: '1' };
  delete env.CC; delete env.CXX;
  run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'dev', '--config', runtimeConfig, ...process.argv.slice(2)], { env });
} catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
