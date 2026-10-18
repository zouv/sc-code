'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ignoreFiles = ['.gitignore', 'src-tauri/.gitignore', 'sidexai/.gitignore',
  'sidexai/sidex-server/.gitignore', 'infrastructure/marketplace-proxy/.gitignore'];

// A fresh repository avoids the real index, global ignores and developer settings.
// Tests also work from a source archive without .git. All scratch stays in .runtime.
function git(cwd, args, input) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const result = spawnSync('git', ['-C', cwd, ...args], { env, input, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.ok(result.status === 0 || (args[0] === 'check-ignore' && result.status === 1),
    result.stderr || 'Git command failed: ' + args.join(' '));
  return result.stdout;
}
function fixture(t) {
  const base = path.join(root, '.runtime/tests');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'gitignore-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q']);
  for (const file of [...ignoreFiles, '.gitattributes']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  return dir;
}
function ignoredPaths(dir, files) {
  return git(dir, ['check-ignore', '--no-index', '--stdin', '-z'], files.join('\0') + '\0')
    .split('\0').filter(Boolean);
}

test('all imported source destinations remain visible to Git ignore rules', t => {
  const dir = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/import-manifest.json'), 'utf8'));
  const files = [...new Set(manifest.files.map(file => file.destination))];
  assert.deepEqual(ignoredPaths(dir, files), []);
});
test('source directories, checked-in runtime assets and reproducible locks are not build output', t => {
  const dir = fixture(t);
  const files = [
    'src/vs/workbench/contrib/logs/browser/logs.contribution.ts',
    'src/sc-code/build/index.ts', 'docs/logs/troubleshooting.md',
    'crates/sidex-context/src/bin/format_bench.rs',
    'extensions-rust/git-extension/src/lib.rs',
    'extensions-rust/css-language-extension/src/css_data.rs',
    'extensions-rust/css-language-extension/css-data.json',
    'extensions-rust/css-language-extension/css-builtin.json',
    'src/vs/workbench/contrib/terminal/common/scripts/psreadline/Microsoft.PowerShell.PSReadLine.dll',
    'public/onig.wasm', 'public/sc-code.svg', 'src-tauri/icons/icon.ico',
    'scripts/bin/xattr', 'Cargo.lock', 'src-tauri/Cargo.lock', 'package-lock.json',
    '.env.example', '.env.development.example', '.claude/skills/init-docs/SKILL.md',
    '.codex/skills/shared/SKILL.md', 'infrastructure/marketplace-proxy/wrangler.toml',
  ];
  assert.deepEqual(ignoredPaths(dir, files), []);
});
test('local runtime, packages, generated metadata, secrets and editor state stay ignored', t => {
  const dir = fixture(t);
  const files = [
    '.runtime/tools/node.exe', '.runtime/logs/smoke.json', '.runtime/tests/fixture.json',
    'packages/dev/ScCode-setup.exe', 'packages/release/ScCode.msi',
    'packages/unpack/dev/ScCode.exe', 'packages/unpack/release/resources/node.exe',
    'node_modules/vite/package.json', 'src-tauri/target/debug/ScCode.exe',
    'src-tauri/gen/schemas/desktop-schema.json', 'dist/assets/main.js', 'out/cache.json',
    'build/output.js', 'logs/startup.txt', 'extensions/builtin/package.json',
    'extensions-meta.json', 'public/builtin-extensions.js',
    'src-tauri/runtime/node.exe', 'src-tauri/tauri.runtime.conf.json',
    '.env', '.env.local', '.env.production', 'aws-credentials.json', 'local.pem',
    '.claude/settings.local.json', '.claude/sessions/current.json', '.codex/config.local.toml',
    '.vscode/settings.json', 'infrastructure/marketplace-proxy/.wrangler/state.json',
    'sidexai/sidex-server/sidex.db', 'sidexai/sidex-server/sidex.db-shm',
    'sidexai/sidex-server/sidex.db-wal', 'sidexai/sidex-server/sidex-server.exe',
    'extensions-rust/Cargo.lock', 'sidex-extension-sdk/Cargo.lock',
    'examples/demo/Cargo.lock', 'coverage/results.json', 'test-results/results.json',
  ];
  assert.deepEqual(ignoredPaths(dir, files).sort(), files.sort());
});
test('ignore regression checks cannot be masked by an already tracked source file', t => {
  const dir = fixture(t), file = 'src/vs/workbench/contrib/logs/common/logsActions.ts';
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), '// tracked source\n');
  git(dir, ['add', file]);
  fs.appendFileSync(path.join(dir, '.gitignore'), '\nlogs/\n');
  assert.deepEqual(ignoredPaths(dir, [file]), [file]);
});
test('Bash scripts use LF and Windows entry points use CRLF on checkout', t => {
  const dir = fixture(t);
  for (const file of ['check-docs.sh', 'manager.sh', 'scripts/bin/xattr'])
    assert.match(git(dir, ['check-attr', 'eol', '--', file]), /: eol: lf\s*$/);
  assert.match(git(dir, ['check-attr', 'eol', '--', 'release.bat']), /: eol: crlf\s*$/);
});
