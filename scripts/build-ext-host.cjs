'use strict';
/**
 * Bundle the real Node extension host.
 *
 * Output: .runtime/desktop/extension-host/extensionHost.js
 * The desktop runtime prep script ships this file next to the legacy host.
 */
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outdir = path.join(root, '.runtime/ext-host');
const outfile = path.join(outdir, 'extensionHost.cjs');

fs.mkdirSync(outdir, { recursive: true });

esbuild.build({
	entryPoints: [path.join(root, 'src/vs/workbench/api/node/scCodeExtHostMain.ts')],
	outfile,
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'cjs',
	tsconfig: path.join(root, 'tsconfig.json'),
	sourcemap: false,
	minify: false,
	logLevel: 'info',
	// Native/optional modules that are loaded dynamically or must resolve from
	// the user's installed extension host environment.
	external: [
		'@vscode/spdlog',
		'@vscode/native-watchdog',
		'@vscode/windows-ca-certs',
		'kerberos',
		'vsda',
		'bufferutil',
		'utf-8-validate',
	],
	banner: {
		js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
	},
	define: {
		'import.meta.url': '__importMetaUrl',
		'import.meta.dirname': '__dirname',
	},
}).then(() => {
	console.log(`[ext-host] bundled ${path.relative(root, outfile)}`);
}).catch(error => {
	console.error('[ext-host] build failed:', error);
	process.exit(1);
});
