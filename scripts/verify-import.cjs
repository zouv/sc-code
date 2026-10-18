'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function verifyImport(root, manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/import-manifest.json'), 'utf8'))) {
  const errors = [], changed = [], seenSource = new Set(), seenDest = new Set();
  if (manifest.schemaVersion !== 1 || manifest.files.length !== manifest.fileCount || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) errors.push('Invalid manifest header/count');
  for (const file of manifest.files) {
    const canonicalEntries = manifest.files.filter(e => e.destination === file.destination && e.kind !== 'consolidated-source');
    const canonical = canonicalEntries.length === 1 ? canonicalEntries[0] : undefined;
    const consolidated = file.kind === 'consolidated-source' && canonical && canonical.sha256 === file.sha256 && canonical.source !== file.source;
    if (seenSource.has(file.source) || (seenDest.has(file.destination) && !consolidated && !(canonical === file && manifest.files.some(e => e.destination === file.destination && e.kind === 'consolidated-source' && e.sha256 === file.sha256)))) errors.push(`Duplicate entry: ${file.source}`);
    if (file.kind === 'consolidated-source' && !consolidated) errors.push(`Invalid consolidated source: ${file.source}`);
    seenSource.add(file.source); seenDest.add(file.destination);
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) errors.push(`Invalid hash: ${file.source}`);
    const dest = path.resolve(root, file.destination), relative = path.relative(root, dest);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { errors.push(`Escaping path: ${file.destination}`); continue; }
    try {
      if (!fs.lstatSync(dest).isFile()) { errors.push(`Not a regular file: ${file.destination}`); continue; }
      const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (hash !== file.sha256) changed.push(file.destination);
    } catch (error) { errors.push(`Missing/unreadable: ${file.destination} (${error.code})`); }
  }
  return { imported: manifest.files.length, unchanged: manifest.files.length - changed.length - errors.length, changed, errors };
}
module.exports = { verifyImport };
if (require.main === module) {
  const result = verifyImport(path.resolve(__dirname, '..'));
  console.log(`Import provenance: ${result.imported} entries, ${result.unchanged} unchanged, ${result.changed.length} independently edited, ${result.errors.length} errors`);
  for (const error of result.errors) console.error(error);
  // The original hashes are provenance, not a requirement to preserve legacy defects.
  process.exitCode = result.errors.length ? 1 : 0;
}
