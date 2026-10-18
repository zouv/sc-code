'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { requiredFiles } = require('../scripts/unpack-output.cjs');
const { sha256, treeHash, validateExtensions } = require('../scripts/desktop-runtime.cjs');
function write(file, contents = 'resource') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}
function runtimeFixture(base, paths, exe = 'executable') {
  write(path.join(base, 'LICENSE'), 'project license');
  for (const file of requiredFiles.filter(file => file !== 'runtime-manifest.json')) write(path.join(paths.build, file));
  write(path.join(paths.build, 'ScCode.exe'), exe);
  write(path.join(paths.build, 'licenses/Node-LICENSE'), 'node license');
  for (const name of ['json', 'typescript', 'git']) {
    write(path.join(paths.build, 'extensions', name, 'package.json'), JSON.stringify({ publisher: 'vscode', name, version: '1', engines: { vscode: '*' }, main: './main.js' }));
    write(path.join(paths.build, 'extensions', name, 'main.js'), 'module.exports = {}');
  }
  refreshManifest(paths);
}
function refreshManifest(paths) {
  const files = requiredFiles.filter(file => !['ScCode.exe', 'runtime-manifest.json'].includes(file) && !file.startsWith('shell-integration/'));
  files.push('licenses/Node-LICENSE');
  const descriptors = validateExtensions(path.join(paths.build, 'extensions'));
  const manifest = { platform: 'win32-x64', builtinCount: descriptors.length, builtinDescriptors: descriptors,
    extensionsHash: treeHash(path.join(paths.build, 'extensions')),
    hostSourceHash: treeHash(path.join(paths.build, 'extension-host'), file => file.endsWith('.cjs') && !file.endsWith('.test.cjs')),
    resources: Object.fromEntries(files.map(relative => ['.runtime/desktop/' + relative, sha256(path.join(paths.build, relative))])) };
  write(path.join(paths.build, 'runtime-manifest.json'), JSON.stringify(manifest));
}
module.exports = { write, runtimeFixture, refreshManifest };
