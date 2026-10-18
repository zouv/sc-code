'use strict';
const test = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, '.runtime/ext-host/extensionHost.cjs');

function startHost(token) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [bundle], {
			env: { ...process.env, SC_CODE_EXT_HOST_PORT: '0', SC_CODE_EXT_HOST_TOKEN: token },
			stdio: ['ignore', 'pipe', 'inherit'],
		});
		let buffer = '';
		const onData = chunk => {
			buffer += chunk;
			const newline = buffer.indexOf('\n');
			if (newline < 0) {
				return;
			}
			child.stdout.off('data', onData);
			const { port } = JSON.parse(buffer.slice(0, newline));
			resolve({ child, port });
		};
		child.stdout.on('data', onData);
		child.on('error', reject);
		child.on('exit', code => reject(new Error(`extension host exited early (${code})`)));
		setTimeout(() => reject(new Error('extension host did not report a port')), 15_000).unref();
	});
}

function waitForReady(port, token) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
		ws.on('message', data => {
			const bytes = Buffer.from(data);
			// PersistentProtocol frames the app payload after its control
			// header; MessageType.Ready = 2 occupies the final byte.
			if (bytes.length > 0 && bytes[bytes.length - 1] === 2) {
				ws.close();
				resolve();
			}
		});
		ws.on('error', reject);
		setTimeout(() => reject(new Error('no Ready message within 5s')), 5_000).unref();
	});
}

test('real extension host bundle boots, authenticates and sends Ready', async () => {
	const token = `test-${Date.now()}-0123456789abcdef`;
	const { child, port } = await startHost(token);
	try {
		await new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=wrong-token`);
			const timer = setTimeout(() => reject(new Error('unauthorized socket was not rejected')), 3_000);
			ws.on('close', code => {
				clearTimeout(timer);
				code === 1008 ? resolve() : reject(new Error(`unexpected close ${code}`));
			});
			ws.on('error', () => {
				clearTimeout(timer);
				resolve();
			});
		});
		// Give the server a moment to finish tearing down the rejected socket
		// before opening the authorized one.
		await new Promise(resolve => setTimeout(resolve, 500));
		await waitForReady(port, token);
	} finally {
		child.kill();
	}
});
