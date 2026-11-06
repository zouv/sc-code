'use strict';
const test = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const root = path.resolve(__dirname, '..');
const bundle = path.join(root, '.runtime/ext-host/extensionHost.cjs');

function startHost(token) {
	return new Promise((resolve, reject) => {
		const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-code-ext-host-test-'));
		const child = spawn(process.execPath, [bundle], {
            windowsHide: true,
			env: { ...process.env, HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile, SC_CODE_HOME: profile, SC_CODE_EXT_HOST_PORT: '0', SC_CODE_EXT_HOST_TOKEN: token },
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

function openReady(port, token) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('no Ready')); }, 5000);
        ws.once('error', reject);
        ws.on('message', data => {
            const bytes = Buffer.from(data);
            if (bytes.at(-1) === 2) { clearTimeout(timer); resolve(ws); }
        });
    });
}

test('each host has one renderer and closing one process does not close another host', async () => {
    const token = 'synthetic-host-isolation-token';
    const a = await startHost(token), b = await startHost(token);
    let socketA, socketB;
    try {
        socketA = await openReady(a.port, token); socketB = await openReady(b.port, token);
        await new Promise((resolve, reject) => {
            const extra = new WebSocket(`ws://127.0.0.1:${b.port}/?token=${token}`);
            const timer = setTimeout(() => { extra.terminate(); reject(new Error('second renderer not rejected')); }, 3000);
            extra.once('close', code => { clearTimeout(timer); code === 1008 ? resolve() : reject(new Error('unexpected close')); });
            extra.once('error', reject);
        });
        const exitPromise = new Promise((resolve, reject) => {
            if (a.child.exitCode !== null) {
                resolve(a.child.exitCode);
                return;
            }
            const timer = setTimeout(() => reject(new Error('host A did not exit within 5s')), 5000);
            a.child.once('exit', code => {
                clearTimeout(timer);
                resolve(code);
            });
        });
        socketA.close();
        const exitCodeA = await exitPromise;
        assert.equal(exitCodeA, 0);
        assert.equal(b.child.exitCode, null); assert.equal(socketB.readyState, WebSocket.OPEN);
    } finally {
        socketA?.terminate(); socketB?.terminate(); a.child.kill(); b.child.kill();
    }
});
