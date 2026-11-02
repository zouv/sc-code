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
	const cspConfig = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
	if (!cspConfig) { throw new Error('Production CSP must not be disabled'); }
	const csp = typeof cspConfig === 'string' ? cspConfig : Object.entries(cspConfig).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(' ') : value}`).join('; ');
	await page.route('**/*', async route => {
		if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === new URL(url).origin) {
			const response = await route.fetch();
			await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
		} else { await route.continue(); }
	});
	await page.addInitScript(() => {
		globalThis.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', event => {
			globalThis.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber });
		});
	});
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
	const cspChecks = await page.evaluate(async () => {
		const script = document.createElement('script');
		script.textContent = 'globalThis.__inlineExecuted = true';
		document.head.appendChild(script);
		await new Promise(resolve => setTimeout(resolve, 100));
		const blockedInline = globalThis.__inlineExecuted !== true;
		const violations = [...globalThis.__cspViolations];
		// Blob workers and WASM are required by editor tokenization.
		const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(7)'], { type: 'text/javascript' })));
		const workerValue = await Promise.race([new Promise(resolve => worker.onmessage = event => resolve(event.data)), new Promise(resolve => setTimeout(() => resolve('timeout'), 3000))]);
		worker.terminate();
		await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		return { blockedInline, workerValue, violations };
	});
	await browser.close();
	await server.close();
	console.log('[smoke:dist] CSP', JSON.stringify(cspChecks));
	if (!cspChecks.blockedInline || cspChecks.workerValue !== 7 || cspChecks.violations.some(event => /script-src|worker-src|connect-src/.test(event.directive) && event.blocked !== 'inline')) {
		fatal.push('CSP security/worker checks failed');
	}

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
