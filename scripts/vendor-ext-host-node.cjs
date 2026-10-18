'use strict';
/**
 * Vendor the Node-side extension-host implementation from a VSCode checkout.
 *
 * The ScCode workbench is a trimmed VSCode web port: it intentionally ships no
 * `src/vs/**\/node` sources. The real extension host needs that Node layer, so
 * this script copies the files required by `src/vs/workbench/api/node/*` from a
 * pinned VSCode tag, without overwriting anything already present.
 *
 * Usage:
 *   node scripts/vendor-ext-host-node.cjs --vscode D:\Git\zoss\vscode --ref 1.110.1
 *
 * The script is idempotent: run it again after bumping the VSCode baseline.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const vscodeRepo = path.resolve(arg('vscode', 'D:/Git/zoss/vscode'));
const ref = arg('ref', '1.110.1');
const entryDir = path.join(root, 'src/vs/workbench/api/node');

function upstreamFile(relPath) {
	try {
		return execFileSync('git', ['-C', vscodeRepo, 'show', `${ref}:${relPath}`], {
			maxBuffer: 32 * 1024 * 1024,
			encoding: 'buffer',
		});
	} catch {
		return null;
	}
}

function resolveLocal(fromFile, specifier) {
	if (!specifier.startsWith('.')) {
		return null;
	}
	const base = path.resolve(path.dirname(fromFile), specifier);
	const withoutJs = base.endsWith('.js') ? base.slice(0, -3) : base;
	for (const candidate of [base, withoutJs, `${withoutJs}.ts`, `${withoutJs}.js`, path.join(withoutJs, 'index.ts')]) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return `${withoutJs}.ts`;
}

function specifiersOf(source) {
	const result = new Set();
	const pattern = /(?:from\s*|import\s*\()['"](\.[^'"]+)['"]/g;
	let match;
	while ((match = pattern.exec(source))) {
		result.add(match[1]);
	}
	return [...result];
}

const queue = [];
for (const name of fs.readdirSync(entryDir)) {
	if (name.endsWith('.ts')) {
		queue.push(path.join(entryDir, name));
	}
}

const copied = [];
const missing = new Set();
const seen = new Set();

while (queue.length) {
	const file = queue.pop();
	if (seen.has(file)) {
		continue;
	}
	seen.add(file);
	if (!fs.existsSync(file)) {
		continue;
	}
	const source = fs.readFileSync(file, 'utf8');
	for (const specifier of specifiersOf(source)) {
		const target = resolveLocal(file, specifier);
		if (!target || fs.existsSync(target)) {
			continue;
		}
		const rel = path.relative(root, target).split(path.sep).join('/');
		const content = upstreamFile(rel);
		if (content === null) {
			missing.add(rel);
			continue;
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
		copied.push(rel);
		queue.push(target);
	}
}

console.log(`[vendor-ext-host] copied ${copied.length} files from ${vscodeRepo}@${ref}`);
if (copied.length) {
	console.log(copied.map(file => `  + ${file}`).join('\n'));
}
if (missing.size) {
	console.error(`[vendor-ext-host] ${missing.size} imports not found upstream:`);
	console.error([...missing].map(file => `  - ${file}`).join('\n'));
	process.exitCode = 1;
}
