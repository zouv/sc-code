'use strict';
/**
 * Production-bundle smoke test.
 *
 * Serves `.runtime/dist` with Vite preview and loads it in a headless browser.
 * This catches build-only failures (chunk cycles/TDZ, missing assets) that the
 * dev server cannot reproduce — e.g. the "Cannot access 'ua' before
 * initialization" black screen caused by splitting base/platform/editor.
 *
 * Usage: npm run smoke:dist
 */
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const distIndex = path.join(root, '.runtime/dist/index.html');

async function main() {
	if (!fs.existsSync(distIndex)) {
		console.error('[smoke:dist] .runtime/dist/index.html missing; run `npm run build` first.');
		process.exit(2);
	}

	const { preview } = await import('vite');
	const server = await preview({ root, preview: { port: 4179, strictPort: true } });
	const url = `http://localhost:${server.config.preview.port}/`;

	const { chromium } = require('playwright');
	let browser = null;
	for (const options of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
		try {
			browser = await chromium.launch({ headless: true, ...options });
			break;
		} catch {
			// Try the next installed browser.
		}
	}
	if (!browser) {
		await server.close();
		console.error('[smoke:dist] no Chromium/Edge/Chrome available; install one with `npx playwright install chromium`.');
		process.exit(2);
	}

	const page = await browser.newPage();
	const fatal = [];
	page.on('pageerror', error => {
		// Outside Tauri the bridge calls fail with "reading 'invoke'"; those are
		// expected in this headless check. Anything else is a real failure.
		if (!/reading 'invoke'|Tauri not available|__TAURI_INTERNALS__/.test(error.message)) {
			fatal.push(`pageerror: ${error.message}`);
		}
	});
	page.on('console', message => {
		if (message.type() === 'error' && /before initialization/.test(message.text())) {
			fatal.push(`console: ${message.text()}`);
		}
	});

	await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
	await page.waitForTimeout(15_000);
	const state = await page.evaluate(() => ({
		body: document.body?.children.length ?? 0,
		marks: performance.getEntriesByType('mark').map(mark => mark.name),
		title: document.title,
	}));
	await browser.close();
	await server.close();

	const started = state.marks.some(name => name === 'code/didStartWorkbench');
	console.log(`[smoke:dist] body=${state.body} title=${state.title} didStartWorkbench=${started}`);
	if (fatal.length || state.body === 0 || !started) {
		console.error('[smoke:dist] FAILED');
		for (const line of fatal) {
			console.error(`  ${line}`);
		}
		process.exit(1);
	}
	console.log('[smoke:dist] passed');
}

main().catch(error => {
	console.error('[smoke:dist] failed:', error);
	process.exit(1);
});
