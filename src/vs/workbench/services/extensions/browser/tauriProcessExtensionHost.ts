/*---------------------------------------------------------------------------------------------
 *  ScCode — local Node extension host over WebSocket.
 *
 *  Implements `IExtensionHost` for `ExtensionHostKind.LocalProcess`: the Rust
 *  supervisor spawns the bundled real VSCode extension host, and this class
 *  connects to it with the same `PersistentProtocol` used by VSCode's remote
 *  extension host.
 *
 *  Enabled by default when the app is running under Tauri, unless explicitly
 *  disabled via `SC_CODE_REAL_EXT_HOST=0`, `localStorage['scode.realExtHost'] === '0'`,
 *  or `?realExtHost=0`.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IMessagePassingProtocol } from '../../../../base/parts/ipc/common/ipc.js';
import { PersistentProtocol } from '../../../../base/parts/ipc/common/ipc.net.js';
import { RemoteConnectionType } from '../../../../platform/remote/common/remoteAuthorityResolver.js';
import { BrowserSocketFactory } from '../../../../platform/remote/browser/browserSocketFactory.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService, ILoggerService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isLoggingOnly } from '../../../../platform/telemetry/common/telemetryUtils.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IDefaultLogLevelsService } from '../../log/common/defaultLogLevels.js';
import * as platform from '../../../../base/common/platform.js';
import { invoke, isTauri, logToHost } from '../../../../scCodeBridge.js';
import { ExtensionHostExitCode, IExtensionHostInitData, MessageType, UIKind, createMessageOfType, isMessageOfType } from '../common/extensionHostProtocol.js';
import { ExtensionHostExtensions, ExtensionHostStartup, IExtensionHost } from '../common/extensions.js';
import { LocalProcessRunningLocation } from '../common/extensionRunningLocation.js';

export interface ITauriExtensionHostInitData {
	readonly extensions: ExtensionHostExtensions;
}

export interface ITauriExtensionHostDataProvider {
	getInitData(): Promise<ITauriExtensionHostInitData>;
}

export interface ITauriExtensionHostEndpoint {
	port: number;
	token: string;
	pid: number;
}

export function isRealExtensionHostEnabled(): boolean {
	if (!isTauri()) {
		return false;
	}
	if (import.meta.env?.SC_CODE_REAL_EXT_HOST === '0') {
		return false;
	}
	if (import.meta.env?.SC_CODE_REAL_EXT_HOST === '1') {
		return true;
	}
	try {
		if (typeof localStorage !== 'undefined') {
			const stored = localStorage.getItem('scode.realExtHost');
			if (stored === '0') {
				return false;
			}
			if (stored === '1') {
				return true;
			}
		}
	} catch {
		// localStorage may be unavailable; fall through to the URL switch.
	}
	if (typeof location !== 'undefined') {
		const param = new URLSearchParams(location.search).get('realExtHost');
		if (param === '0' || param === 'false') {
			return false;
		}
		if (param !== null) {
			return true;
		}
	}
	return true;
}

export class TauriProcessExtensionHost extends Disposable implements IExtensionHost {

	public pid: number | null = null;
	public readonly remoteAuthority = null;
	public extensions: ExtensionHostExtensions | null = null;

	private readonly _onDidExit = this._register(new Emitter<[number, string | null]>());
	public readonly onExit: Event<[number, string | null]> = this._onDidExit.event;

	private _protocolPromise: Promise<IMessagePassingProtocol> | null = null;
	private _protocol: PersistentProtocol | null = null;
	private _isTerminating = false;
	private readonly _hostId = generateUuid();

	constructor(
		public readonly runningLocation: LocalProcessRunningLocation,
		public readonly startup: ExtensionHostStartup,
		private readonly _initDataProvider: ITauriExtensionHostDataProvider,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ILabelService private readonly _labelService: ILabelService,
		@ILogService private readonly _logService: ILogService,
		@ILoggerService private readonly _loggerService: ILoggerService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IUserDataProfilesService private readonly _userDataProfilesService: IUserDataProfilesService,
		@IProductService private readonly _productService: IProductService,
		@IDefaultLogLevelsService private readonly _defaultLogLevelsService: IDefaultLogLevelsService,
	) {
		super();
	}

	public start(): Promise<IMessagePassingProtocol> {
		if (!this._protocolPromise) {
			this._protocolPromise = this._start().catch(error => {
				void invoke('real_ext_host_stop', { hostId: this._hostId }).catch(stopError => this._logService.warn('[extHost] cleanup failed', stopError));
				throw error;
			});
		}
		return this._protocolPromise;
	}

	private async _start(): Promise<IMessagePassingProtocol> {
		logToHost(3, '[extHost] requesting real extension host endpoint');
		const endpoint = await invoke<ITauriExtensionHostEndpoint>('real_ext_host_start', { hostId: this._hostId });
		if (this._isTerminating) {
			await invoke('real_ext_host_stop', { hostId: this._hostId });
			throw new Error('Extension host disposed while starting.');
		}
		if (!endpoint || !endpoint.port) {
			logToHost(1, '[extHost] real extension host endpoint unavailable');
			throw new Error('The local extension host could not be started.');
		}
		this.pid = endpoint.pid;
		logToHost(3, `[extHost] connecting to 127.0.0.1:${endpoint.port} (pid ${endpoint.pid})`);

		const factory = new BrowserSocketFactory(null);
		const socket = await factory.connect(
			{ type: RemoteConnectionType.WebSocket, host: '127.0.0.1', port: endpoint.port },
			'/',
			`token=${encodeURIComponent(endpoint.token)}`,
			'extensionHost'
		);
		if (this._isTerminating) {
			socket.dispose();
			throw new Error('Extension host disposed while connecting.');
		}
		const protocol = new PersistentProtocol({ socket });
		this._protocol = protocol;
		this._register(protocol);

		protocol.onDidDispose(() => this._onConnectionLost());
		protocol.onSocketClose(() => this._onConnectionLost());

		return new Promise<IMessagePassingProtocol>((resolve, reject) => {
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) { return; }
				settled = true;
				clearTimeout(timeout);
				listener.dispose();
				disposeListener.dispose();
				closeListener.dispose();
				if (error) { reject(error); } else { resolve(protocol); }
			};
			const timeout = setTimeout(() => finish(new Error('The local extension host took longer than 60s to send its ready message.')), 60_000);
			const disposeListener = protocol.onDidDispose(() => finish(new Error('Extension host disposed during handshake.')));
			const closeListener = protocol.onSocketClose(() => finish(new Error('Extension host disconnected during handshake.')));
			const listener = protocol.onMessage(msg => {
				if (isMessageOfType(msg, MessageType.Ready)) {
					void this._createExtHostInitData().then(data => {
						if (settled || this._isTerminating) { return; }
						protocol.send(VSBuffer.fromString(JSON.stringify(data)));
					}).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
					return;
				}
				if (isMessageOfType(msg, MessageType.Initialized)) {
					logToHost(3, '[extHost] real extension host initialized');
					finish();
					return;
				}
				this._logService.warn('[extHost] unexpected message during handshake');
			});
		});
	}

	private _onConnectionLost(): void {
		if (this._isTerminating) {
			return;
		}
		this._onDidExit.fire([ExtensionHostExitCode.UnexpectedError, null]);
	}

	private async _createExtHostInitData(): Promise<IExtensionHostInitData> {
		const data = await this._initDataProvider.getInitData();
		this.extensions = data.extensions;
		const workspace = this._contextService.getWorkspace();
		const nativeUserDataDir = (globalThis as { __SC_CODE_USER_DATA_DIR__?: string }).__SC_CODE_USER_DATA_DIR__;
		const nativeUserDataUri = typeof nativeUserDataDir === 'string' && nativeUserDataDir.length > 0
			? URI.file(nativeUserDataDir)
			: undefined;
		const globalStorageHome = nativeUserDataUri
			? joinPath(nativeUserDataUri, 'User', 'globalStorage')
			: this._userDataProfilesService.defaultProfile.globalStorageHome;
		const workspaceStorageHome = nativeUserDataUri
			? joinPath(nativeUserDataUri, 'User', 'workspaceStorage')
			: this._environmentService.workspaceStorageHome;
		const logsLocation = nativeUserDataUri
			? joinPath(nativeUserDataUri, 'logs', 'localProcess')
			: joinPath(this._environmentService.extHostLogsPath, 'localProcess');
		return {
			commit: this._productService.commit,
			version: this._productService.version,
			quality: this._productService.quality,
			date: this._productService.date,
			parentPid: this.pid ?? 0,
			environment: {
				isExtensionDevelopmentDebug: this._environmentService.debugRenderer,
				appName: this._productService.nameLong,
				appHost: this._productService.embedderIdentifier ?? 'desktop',
				appUriScheme: this._productService.urlProtocol,
				appLanguage: platform.language,
				isExtensionTelemetryLoggingOnly: isLoggingOnly(this._productService, this._environmentService),
				extensionDevelopmentLocationURI: this._environmentService.extensionDevelopmentLocationURI,
				extensionTestsLocationURI: this._environmentService.extensionTestsLocationURI,
				globalStorageHome,
				workspaceStorageHome,
				extensionLogLevel: this._defaultLogLevelsService.defaultLogLevels.extensions,
				isSessionsWindow: this._environmentService.isSessionsWindow,
				isPortable: false,
			},
			workspace: this._contextService.getWorkbenchState() === WorkbenchState.EMPTY ? undefined : {
				configuration: workspace.configuration || undefined,
				id: workspace.id,
				name: this._labelService.getWorkspaceLabel(workspace),
				transient: workspace.transient,
			},
			extensions: this.extensions?.toSnapshot() ?? { versionId: 0, allExtensions: [], activationEvents: {}, myExtensions: [] },
			consoleForward: {
				includeStack: false,
				logNative: this._environmentService.debugRenderer,
			},
			telemetryInfo: {
				sessionId: this._telemetryService.sessionId,
				machineId: this._telemetryService.machineId,
				sqmId: this._telemetryService.sqmId,
				devDeviceId: this._telemetryService.devDeviceId ?? this._telemetryService.machineId,
				firstSessionDate: this._telemetryService.firstSessionDate,
				msftInternal: this._telemetryService.msftInternal,
			},
			remoteExtensionTips: this._productService.remoteExtensionTips,
			virtualWorkspaceExtensionTips: this._productService.virtualWorkspaceExtensionTips,
			logLevel: this._logService.getLevel(),
			loggers: [...this._loggerService.getRegisteredLoggers()],
			logsLocation,
			autoStart: this.startup !== ExtensionHostStartup.EagerManualStart,
			remote: { authority: null, connectionData: null, isRemote: false },
			uiKind: UIKind.Desktop,
		};
	}

	getInspectPort(): undefined {
		return undefined;
	}

	enableInspectPort(): Promise<boolean> {
		return Promise.resolve(false);
	}

	async disconnect(): Promise<void> {
		this._isTerminating = true;
		this._protocol?.send(createMessageOfType(MessageType.Terminate));
		this._protocol?.sendDisconnect();
		try { await this._protocol?.drain(); } finally {
			await invoke('real_ext_host_stop', { hostId: this._hostId });
		}
	}

	override dispose(): void {
		void this.disconnect().catch(error => this._logService.warn('[extHost] shutdown failed', error));
		this._protocol = null;
		super.dispose();
	}
}
