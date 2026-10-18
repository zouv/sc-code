'use strict';
// Consolidated provenance must retain a unique canonical source with the original hash.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { verifyImport } = require('../scripts/verify-import.cjs');
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-provenance-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 fs.writeFileSync(path.join(root, 'script.ps1'), 'source');
 const hash = crypto.createHash('sha256').update('source').digest('hex');
 const canonical = { source: 'original/script.ps1', destination: 'script.ps1', sha256: hash, kind: 'source' };
 const alias = { source: 'old-duplicate/script.ps1', destination: 'script.ps1', sha256: hash, kind: 'consolidated-source' };
 const manifest = entries => ({ schemaVersion: 1, sourceCommit: 'a'.repeat(40), fileCount: entries.length, files: entries });
 return { root, canonical, alias, manifest };
}
test('consolidated source validates in either entry order without deleting provenance', t => {
 const f = fixture(t);
 for (const entries of [[f.canonical, f.alias], [f.alias, f.canonical]]) {
  const result = verifyImport(f.root, f.manifest(entries)); assert.deepEqual(result.errors, []); assert.equal(result.imported, 2);
 }
});
test('duplicate canonical sources and orphan/mismatched consolidation are rejected', t => {
 const f = fixture(t);
 for (const entries of [[f.canonical, { ...f.canonical, source: 'other' }], [f.alias], [f.canonical, { ...f.alias, sha256: 'b'.repeat(64) }]]) {
  assert.ok(verifyImport(f.root, f.manifest(entries)).errors.length > 0);
 }
});
