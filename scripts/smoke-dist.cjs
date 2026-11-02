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
	const security = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security;
	const cspConfig = security.csp;
	if (!cspConfig) { throw new Error('Production CSP must not be disabled'); }
	// Reproduce Tauri's CSP modification: it adds a nonce to every static
	// <style> and appends 'nonce-…' to style-src unless that directive is
	// opted out. A style nonce makes 'unsafe-inline' ineffective and blocks
	// VS Code's runtime theme/codicon/menu styles (the 0.4.1 UI regression).
	const disabled = security.dangerousDisableAssetCspModification;
	const styleCspModified = disabled !== true && !(Array.isArray(disabled) && disabled.includes('style-src'));
	const builtHtml = fs.readFileSync(distIndex, 'utf8');
	const styleNonce = styleCspModified && /<style[\s>]/i.test(builtHtml) ? 'scCodeSmokeNonce123' : undefined;
	const csp = typeof cspConfig === 'string'
		? cspConfig
		: Object.entries(cspConfig).map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(' ') : value}${key === 'style-src' && styleNonce ? ` 'nonce-${styleNonce}'` : ''}`).join('; ');
	await page.route('**/*', async route => {
		if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === new URL(url).origin) {
			const response = await route.fetch();
			let body = await response.text();
			if (styleNonce) { body = body.replace(/<style(?![^>]*\bnonce=)/gi, `<style nonce="${styleNonce}"`); }
			const headers = { ...response.headers(), 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp };
			delete headers['content-encoding']; delete headers['content-length'];
			await route.fulfill({ status: response.status(), headers, body });
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
		// Runtime-injected <style> is how VS Code applies themes and codicons.
		const probeStyle = document.createElement('style');
		probeStyle.textContent = '#csp-runtime-style-probe { color: rgb(1, 2, 3); }';
		document.head.appendChild(probeStyle);
		const probe = document.createElement('div');
		probe.id = 'csp-runtime-style-probe';
		document.body.appendChild(probe);
		const runtimeStyle = { color: getComputedStyle(probe).color, rules: probeStyle.sheet ? probeStyle.sheet.cssRules.length : 0 };
		probeStyle.remove(); probe.remove();
		const workbench = document.querySelector('.monaco-workbench');
		const themeBackground = workbench ? getComputedStyle(workbench).getPropertyValue('--vscode-editor-background').trim() : '';
		const icon = document.querySelector('.codicon[class*="codicon-"]');
		const iconGlyph = icon ? getComputedStyle(icon, '::before').content : '';
		// Blob workers and WASM are required by editor tokenization.
		const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(7)'], { type: 'text/javascript' })));
		const workerValue = await Promise.race([new Promise(resolve => worker.onmessage = event => resolve(event.data)), new Promise(resolve => setTimeout(() => resolve('timeout'), 3000))]);
		worker.terminate();
		await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		return { blockedInline, workerValue, violations, runtimeStyle, themeBackground, iconGlyph };
	});
	await browser.close();
	await server.close();
	console.log('[smoke:dist] CSP', JSON.stringify(cspChecks));
	if (!cspChecks.blockedInline || cspChecks.workerValue !== 7 || cspChecks.violations.some(event => /script-src|worker-src|connect-src/.test(event.directive) && event.blocked !== 'inline')) {
		fatal.push('CSP security/worker checks failed');
	}
	if (cspChecks.runtimeStyle.color !== 'rgb(1, 2, 3)' || cspChecks.runtimeStyle.rules === 0) {
		fatal.push(`runtime <style> injection blocked by CSP: ${JSON.stringify(cspChecks.runtimeStyle)}`);
	}
	if (!cspChecks.themeBackground) { fatal.push('workbench theme CSS variables missing'); }
	if (!cspChecks.iconGlyph || ['none', 'normal', '""'].includes(cspChecks.iconGlyph)) { fatal.push(`codicon glyph CSS missing: ${JSON.stringify(cspChecks.iconGlyph)}`); }
	const styleViolations = cspChecks.violations.filter(event => /^style-src/.test(event.directive));
	if (styleViolations.length) { fatal.push(`CSP style violations: ${JSON.stringify(styleViolations.slice(0, 3))}`); }

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
