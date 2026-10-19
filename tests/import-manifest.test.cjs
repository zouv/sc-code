'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { verifyImport } = require('../scripts/verify-import.cjs');
const root = path.resolve(__dirname, '..');
test('all 3664 retained original files remain represented after independent development', () => {
  const result = verifyImport(root);
  assert.equal(result.imported, 3664); assert.deepEqual(result.errors, []);
});
test('independent product identity and updates do not reference old release channel', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json')));
  assert.equal(pkg.name, 'sc-code'); assert.equal(conf.productName, 'ScCode');
  assert.equal(pkg.version, conf.version); assert.equal(conf.identifier, 'dev.sccode.app');
  assert.equal(conf.plugins.updater, undefined);
  for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
    const text = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    assert.doesNotMatch(text, /siden\.dev|siden\.ai|s3:\/\/|SC_CODE_SIGNING|tauri-action|contents:\s*write/);
  }
});
test('custom mechanisms have become ordinary feature modules', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
  for (const name of ['vsix-install/vsixInstall', 'accessibility/accessibleViewInformationService', 'extension-sync/extensionSync']) assert.ok(main.includes(`./sc-code/${name}.contribution`));
  assert.doesNotMatch(main, /CUSTOMIZATIONS\/src/);
});
