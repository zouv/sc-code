/*---------------------------------------------------------------------------------------------
 *  ScCode — real Node extension host over a local WebSocket.
 *
 *  This is the entry point bundled into `extensionHost.js` and spawned by the
 *  Rust supervisor. Unlike the legacy hand-written `host.cjs` shim, it boots
 *  VSCode's real extension host (`ExtensionHostMain`) and therefore supports
 *  the full `vscode` API implemented by the workbench port.
 *
 *  Transport: a loopback WebSocket carrying `PersistentProtocol` frames. The
 *  workbench side uses `BrowserSocket` + `PersistentProtocol`, so both ends
 *  speak exactly the same byte-oriented protocol VSCode uses between the
 *  renderer and a local/remote extension host.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { IMessagePassingProtocol } from '../../../base/parts/ipc/common/ipc.js';
import { ISocket, PersistentProtocol, SocketCloseEvent, SocketCloseEventType } from '../../../base/parts/ipc/common/ipc.net.js';
import { Promises } from '../../../base/node/pfs.js';
import { ExtensionHostMain } from '../common/extensionHostMain.js';
import { IHostUtils } from '../common/extHostExtensionService.js';
import { IExtensionHostInitData, MessageType, createMessageOfType } from '../../services/extensions/common/extensionHostProtocol.js';
import '../common/extHost.common.services.js';
import './extHost.sc-code.services.js';

class WebSocketSocket extends Disposable implements ISocket {
	private readonly _onData = this._register(new Emitter<VSBuffer>());
	private readonly _onClose = this._register(new Emitter<SocketCloseEvent>());
	private readonly _onEnd = this._register(new Emitter<void>());
	private _ended = false;

	constructor(private readonly _ws: WebSocket) {
		super();
		_ws.binaryType = 'arraybuffer';
		_ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
			const buffer = Array.isArray(data)
				? Buffer.concat(data)
				: Buffer.isBuffer(data)
					? data
					: Buffer.from(data);
			this._onData.fire(VSBuffer.wrap(buffer));
		});
		_ws.on('close', (code: number, reason: Buffer) => {
			this._onClose.fire({
				type: SocketCloseEventType.WebSocketCloseEvent,
				code,
				reason: reason.toString(),
				wasClean: code === 1000,
				event: undefined,
			} as never);
			this._onEnd.fire();
		});
		_ws.on('error', error => {
			console.error('[ext-host] websocket error:', error);
			this._onClose.fire({ type: SocketCloseEventType.NodeSocketCloseEvent, hadError: true, error });
		});
	}

	onData(listener: (e: VSBuffer) => void): IDisposable {
		return this._onData.event(listener);
	}
	onClose(listener: (e: SocketCloseEvent) => void): IDisposable {
		return this._onClose.event(listener);
	}
	onEnd(listener: () => void): IDisposable {
		return this._onEnd.event(listener);
	}
	write(buffer: VSBuffer): void {
		if (!this._ended) {
			this._ws.send(buffer.buffer);
		}
	}
	end(): void {
		this._ended = true;
		this._ws.close();
	}
	drain(): Promise<void> {
		return Promise.resolve();
	}
	traceSocketEvent(): void {
		// Diagnostics are disabled for the local transport.
	}
	override dispose(): void {
		this._ended = true;
		this._ws.terminate();
		super.dispose();
	}
}

function verifyToken(requestUrl: string | undefined, expected: string): boolean {
	if (!requestUrl || !expected) {
		return false;
	}
	let token: string | null = null;
	try {
		token = new URL(requestUrl, 'http://127.0.0.1').searchParams.get('token');
	} catch {
		return false;
	}
	if (!token) {
		return false;
	}
	const actual = Buffer.from(token);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

async function connectToRenderer(protocol: IMessagePassingProtocol): Promise<{ protocol: IMessagePassingProtocol; initData: IExtensionHostInitData }> {
	return new Promise(resolve => {
		const first = protocol.onMessage(raw => {
			first.dispose();
			const initData = JSON.parse(raw.toString()) as IExtensionHostInitData;
			protocol.send(createMessageOfType(MessageType.Initialized));
			resolve({ protocol, initData });
		});
		protocol.send(createMessageOfType(MessageType.Ready));
	});
}

async function start(): Promise<void> {
	const expectedToken = process.env.SC_CODE_EXT_HOST_TOKEN || '';
	const port = Number(process.env.SC_CODE_EXT_HOST_PORT || '0');
	const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 512 * 1024 * 1024 });

	await new Promise<void>((resolve, reject) => {
		wss.once('listening', () => resolve());
		wss.once('error', reject);
	});
	const address = wss.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	process.stdout.write(`${JSON.stringify({ port: actualPort, pid: process.pid })}\n`);

	wss.on('connection', (ws: WebSocket, request) => {
		if (!verifyToken(request.url, expectedToken)) {
			ws.close(1008, 'unauthorized');
			return;
		}

		const socket = new WebSocketSocket(ws);
		const protocol = new PersistentProtocol({ socket });
		console.log(`[ext-host] renderer connected (pid ${process.pid})`);

		// The renderer constructs its PersistentProtocol right after the socket
		// opens. Sending `Ready` synchronously can race ahead of that listener,
		// so give it a tick to attach before the handshake starts.
		setTimeout(() => {
			connectToRenderer(protocol).then(({ initData }) => {
				const hostUtils: IHostUtils = {
					_serviceBrand: undefined,
					pid: process.pid,
					exit: code => process.exit(code),
					fsExists: path => Promises.exists(path),
					fsRealpath: path => Promises.realpath(path),
				};
				const main = new ExtensionHostMain(protocol, initData, hostUtils, null);
				process.on('SIGTERM', () => main.terminate('SIGTERM'));
				console.log(`[ext-host] initialized with ${initData.extensions.allExtensions.length} extension(s)`);
			}).catch(error => {
				console.error('[ext-host] handshake failed:', error);
				process.exit(1);
			});
		}, 300);

		socket.onClose(() => {
			// The renderer went away (window closed or reloaded); the host has no
			// work without it.
			setTimeout(() => process.exit(0), 1000);
		});
	});

	const shutdown = () => {
		wss.close();
		process.exit(0);
	};
	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

start().catch(error => {
	console.error('[ext-host] fatal:', error);
	process.exit(1);
});
