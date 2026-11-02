'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');
const root = path.resolve(__dirname, '..');
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { return collect(file); }
    const relative = path.relative(root, file).replaceAll('\\', '/');
    // ScCode-owned adapters/features only. Imported VS Code sources are an
    // explicit separate baseline, not silently reformatted by routine lint.
    return /\.tsx?$/.test(entry.name) && (relative.startsWith('src/sc-code/') || ['src/main.ts', 'src/bootstrap-globals.ts', 'src/nls-loader.ts'].includes(relative) || /(?:^|\/)(?:scCode|tauri)[^/]*(?:\/|$)/.test(relative) || /^scCode|^tauri/.test(entry.name)) ? [file] : [];
  });
}
(async () => {
  const fix = process.argv.includes('--fix');
  const eslint = new ESLint({ cwd: root, fix });
  const files = collect(path.join(root, 'src'));
  const results = await eslint.lintFiles(files);
  if (fix) { await ESLint.outputFixes(results); }
  console.log(`Checked ${files.length} ScCode-owned TypeScript files.`);
  console.log((await eslint.loadFormatter('stylish')).format(results));
  if (results.some(result => result.errorCount > 0)) { process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
