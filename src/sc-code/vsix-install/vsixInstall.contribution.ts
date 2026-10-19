/*---------------------------------------------------------------------------------------------
 *  ScCode —— 从本地 .vsix 安装扩展
 *
 *  为什么需要这个模块：
 *  ScCode 前端跑在 Web 模式（`isWeb === true`），`ExtensionManagementServerService` 只注册了
 *  web 扩展服务器，`localExtensionManagementServer` 恒为 null。于是上游 VSCode 的 VSIX 安装链路
 *  在本项目里整体断掉：
 *    - 「Install from VSIX...」菜单的 when 条件要求 hasLocalServer || hasRemoteServer（全为 false），
 *      命令与菜单项都不会出现；
 *    - `ExtensionManagementService.getManifest(vsix)` 对 file:// 直接 reject('No Servers')，
 *      `installVSIX()` → `getServersToInstall()` 同样 reject('No Servers to Install')。
 *  Rust 侧的安装能力其实早已具备（`src-tauri/src/commands/extensions.rs` 的 `install_extension` →
 *  `crates/sc-code-extensions/src/vsix.rs`，解压到 %APPDATA%\ScCode\extensions\<publisher>.<name>），
 *  只是前端从未接过线。
 *
 *  本模块把两端接起来（不改上游扩展管理逻辑）：
 *    1. 命令面板 / 扩展视图标题菜单「...」/ 资源管理器右键 .vsix / 把 .vsix 拖进窗口
 *    2. 原生文件对话框选包（IFileDialogService 已桥接 Tauri dialog 插件）
 *    3. Tauri `install_extension` 解压到扩展目录
 *    4. web 扩展服务的 `installFromLocation(已装目录)`：
 *         - 写入扩展视图的已安装记录（IndexedDB，location 指向磁盘目录）
 *         - 触发 onDidInstallExtensions → `tauriExtensionHost.contribution.ts` 既有的热加载逻辑
 *           （loadExtension + activateExtension + 注册 contributes.commands）
 *  卸载沿用既有链路：扩展视图卸载 → onDidUninstallExtension → Tauri `uninstall_extension`。
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage } from 'vs/base/common/errors.js';
import { hash } from 'vs/base/common/hash.js';
import { ParseError, ParseErrorCode, parse } from 'vs/base/common/json.js';
import { getParseErrorMessage } from 'vs/base/common/jsonErrorMessages.js';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle.js';
import * as path from 'vs/base/common/path.js';
import Severity from 'vs/base/common/severity.js';
import { URI } from 'vs/base/common/uri.js';
import { mainWindow } from 'vs/base/browser/window.js';
import { localize, localize2 } from 'vs/nls.js';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands.js';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation.js';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs.js';
import { INotificationService } from 'vs/platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions.js';
import { ResourceContextKey } from 'vs/workbench/common/contextkeys.js';
import { VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions.js';
import { IExtensionManagementServer, IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement.js';
import { IHostService } from 'vs/workbench/services/host/browser/host.js';
import { extractFileUrisFromDragEvent } from 'vs/platform/dnd/browser/dnd.js';
import { IUserDataProfileService } from 'vs/workbench/services/userDataProfile/common/userDataProfile.js';

export const INSTALL_VSIX_COMMAND_ID = 'sc-code.extensions.installFromVSIX';

const isScCodeTauri = (globalThis as any).__SC_CODE_TAURI__ === true;

const ExtensionsCategory = {
	value: localize('extensions', 'Extensions'),
	original: 'Extensions'
};

/** Tauri `install_extension` 命令的返回值（见 src-tauri/src/commands/extensions.rs） */
interface InstalledVsix {
	id: string;
	name: string;
	version: string;
	/** 安装落地的目录（%APPDATA%\ScCode\extensions\<publisher>.<name>） */
	path: string;
}

/**
 * 命令入口一次性解析出的服务集合。
 * ⚠️ `ServicesAccessor` 只在**同步调用栈内**有效，`await` 之后再 `accessor.get(...)` 会抛
 * "Illegal state: service accessor is only valid during the invocation of its target method"，
 * 所以所有服务必须在进入命令时同步取出，再传下去用。
 */
interface InstallContext {
	notificationService: INotificationService;
	progressService: IProgressService;
	fileDialogService: IFileDialogService;
	extensionManagementServer: IExtensionManagementServer;
	profileLocation: URI;
}

function createInstallContext(accessor: ServicesAccessor): InstallContext {
	const extensionManagementServer = accessor.get(IExtensionManagementServerService).webExtensionManagementServer;
	if (!extensionManagementServer) {
		throw new Error(localize('sc-code.installVSIX.noServer', 'No extension management server is available.'));
	}
	return {
		notificationService: accessor.get(INotificationService),
		progressService: accessor.get(IProgressService),
		fileDialogService: accessor.get(IFileDialogService),
		extensionManagementServer,
		profileLocation: accessor.get(IUserDataProfileService).currentProfile.extensionsResource
	};
}

/**
 * 调用 Tauri 把 .vsix 解压到扩展目录。只做磁盘安装，不写扩展视图记录。
 */
async function installVsixToDisk(vsixPath: string): Promise<InstalledVsix> {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke<InstalledVsix>('install_extension', { vsixPath });
}

/**
 * 把已落地的扩展目录登记进扩展管理链路：
 * 写入已安装记录 → 触发 onDidInstallExtensions → 扩展宿主热加载并激活。
 */
async function registerInstalledExtension(context: InstallContext, installDir: string): Promise<void> {
	await context.extensionManagementServer.extensionManagementService.installFromLocation(
		URI.file(installDir),
		context.profileLocation
	);
}

async function installVsixPaths(context: InstallContext, vsixPaths: string[]): Promise<void> {
	await context.progressService.withProgress(
		{
			location: ProgressLocation.Notification,
			title: localize('sc-code.installVSIX.progress', 'Installing extension from VSIX...')
		},
		async progress => {
			for (const vsixPath of vsixPaths) {
				const fileName = path.basename(vsixPath);
				progress.report({ message: fileName });
				try {
					const installed = await installVsixToDisk(vsixPath);
					// 升级/重装时磁盘目录已就位，这里只负责让扩展视图与扩展宿主看到它
					await registerInstalledExtension(context, installed.path);
					context.notificationService.notify({
						severity: Severity.Info,
						message: localize(
							'sc-code.installVSIX.done',
							"Installed extension '{0}' ({1}).",
							installed.name || installed.id,
							installed.version
						)
					});
				} catch (error) {
					context.notificationService.error(
						localize(
							'sc-code.installVSIX.failed',
							"Failed to install '{0}': {1}",
							fileName,
							getErrorMessage(error)
						)
					);
				}
			}
		}
	);
}

if (isScCodeTauri) {
	CommandsRegistry.registerCommand({
		id: INSTALL_VSIX_COMMAND_ID,
		metadata: {
			description: localize('sc-code.installVSIX.description', 'Install an extension from a local .vsix package')
		},
		handler: async (accessor: ServicesAccessor, ...resources: (URI | string)[]) => {
			// 注意：以下 accessor.get 全部发生在第一个 await 之前（accessor 只在同步栈内有效）
			const notificationService = accessor.get(INotificationService);
			let context: InstallContext;
			try {
				context = createInstallContext(accessor);
			} catch (error) {
				notificationService.error(localize('sc-code.installVSIX.noServerError', 'Cannot install VSIX: {0}', getErrorMessage(error)));
				return;
			}

			const vsixPaths = resources
				.map(resource => (URI.isUri(resource) ? resource.fsPath : typeof resource === 'string' ? resource : undefined))
				.filter((value): value is string => !!value && value.toLowerCase().endsWith('.vsix'));

			if (vsixPaths.length > 0) {
				await installVsixPaths(context, vsixPaths);
				return;
			}

			const picked = await context.fileDialogService.showOpenDialog({
				title: localize('sc-code.installVSIX.pickTitle', 'Install from VSIX'),
				filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
				canSelectFiles: true,
				canSelectMany: true
			});
			if (!picked?.length) {
				return;
			}
			await installVsixPaths(context, picked.map(uri => uri.fsPath));
		}
	});

	// 命令面板
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
		command: {
			id: INSTALL_VSIX_COMMAND_ID,
			title: localize2('sc-code.installVSIX.commandTitle', 'Install Extension from VSIX...'),
			category: ExtensionsCategory
		}
	});

	// 扩展视图标题栏的「...」菜单（对齐上游 hasLocalServer 时才出现的那一项）
	MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, {
		command: {
			id: INSTALL_VSIX_COMMAND_ID,
			title: localize('sc-code.installVSIX.shortTitle', 'Install from VSIX...')
		},
		when: ContextKeyExpr.equals('viewContainer', VIEWLET_ID),
		group: '3_install',
		order: 1
	});

	// 资源管理器里右键 .vsix
	MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
		command: {
			id: INSTALL_VSIX_COMMAND_ID,
			title: localize('sc-code.installVSIX.contextTitle', 'Install Extension VSIX')
		},
		when: ResourceContextKey.Extension.isEqualTo('.vsix'),
		group: 'extensions'
	});
}

/**
 * 拖放（**HTML5 `drop`**，不是 Tauri 原生拖放）——CUSTOM-20261017-001 / CUSTOM-20261017-005
 *
 * `tauri.conf.json` 的 `dragDropEnabled` 已改为 `false`（Windows 下 Tauri 原生接管会吞掉 webview 内
 * 全部 HTML5 拖拽，见 pitfalls #15），于是 Tauri `onDragDropEvent` 不再触发，拖放全走 HTML5。
 * 两条链路分工：
 *
 * 1. **`.vsix` → 本模块接管**（workbench 不认识这种拖入）：优先用真实路径（`File.path` /
 *    `text/uri-list`，见 `extractFileUrisFromDragEvent`）直接安装；拿不到路径才把内容写进临时文件
 *    再走既有安装命令。
 * 2. **`.code-workspace`（以及其它一切文件）→ 优先交给 workbench**（`ResourcesDropHandler`），
 *    与 VSCode 桌面版一致：拖到**标签栏**=按文件打开，拖到**编辑区**=按 workspace 打开。
 *    仅当拿不到真实路径时（webview 没给 `text/uri-list`）才由本模块兜底：
 *      - 标签栏：不拦截，让 workbench 按「未命名副本」打开（内容一致，至少能看）
 *      - 编辑区：解析 JSONC 内容——
 *          · folders 全绝对：把内容原样写成一份稳定路径的临时 `.code-workspace`（按内容哈希复用），
 *            再按 `workspaceUri` 打开（多根 + settings 都完整；不能直接 `openWindow(folders)`，
 *            见 `stageDroppedWorkspaceFile()` 的注释）
 *          · 含相对路径：相对基准未知 → 通知 +「Locate File…」让用户重新定位原 workspace 文件，
 *            拿到真实路径后按文件打开
 *        **编辑区必须拦截**：否则平台会拿这份未命名副本当 `workspaceUri` 去重载窗口，
 *        进入一个 `untitled:` 的非法工作区状态。
 */
class InstallVsixOnDropContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sc-code.installVsixOnDrop';

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService
	) {
		super();
		this._registerDropListener();
	}

	private _registerDropListener(): void {
		// 捕获阶段：`.vsix` 与「拿不到路径的 .code-workspace」都需要抢在 workbench 之前接管
		const listener = (event: DragEvent) => this._onDrop(event);
		mainWindow.addEventListener('drop', listener, true);
		this._register(toDisposable(() => mainWindow.removeEventListener('drop', listener, true)));
	}

	private _onDrop(event: DragEvent): void {
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length === 0) {
			return;
		}

		// [drop-diag] 每次「带文件的拖入」都留一条日志（dev 构建落盘）：能直接看出这次有没有拿到真实路径，
		// 以及 dataTransfer 里到底有什么（types / File.path / text/uri-list / 落点）。
		const realPaths = droppedFilePaths(event);
		logDropDiagnostics('file drop', event, `realPaths=${realPaths.length} names=${files.map(file => file.name).join('|')}`);

		const vsixFiles = files.filter(file => file.name.toLowerCase().endsWith('.vsix'));
		if (vsixFiles.length > 0) {
			event.preventDefault();
			event.stopPropagation();
			void this._installDroppedVsix(realPaths, vsixFiles).catch(error =>
				console.error('[ScCode] Failed to install dropped VSIX:', error)
			);
			return;
		}

		const workspaceFiles = files.filter(file => file.name.toLowerCase().endsWith('.code-workspace'));
		if (workspaceFiles.length === 0) {
			return; // 其它文件：全部交给 workbench 自己的 drop 处理
		}

		// 有真实路径 → 交给 workbench（标签栏开文件 / 编辑区开 workspace，与 VSCode 桌面版一致）
		if (realPaths.length > 0) {
			return;
		}

		// 无真实路径：标签栏仍交给 workbench（按未命名副本打开），编辑区由本模块兜底
		if (isInsideTabsContainer(event.target)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		void this._openWorkspaceFromDroppedFile(workspaceFiles[0], event).catch(error =>
			console.error('[ScCode] Failed to open dropped workspace:', error)
		);
	}

	/**
	 * 优先用磁盘上的真实路径安装（拖入的文件与 `text/uri-list` 按文件名配对）；
	 * 配不上（拿不到路径）的文件才落临时副本。
	 */
	private async _installDroppedVsix(realPaths: string[], vsixFiles: File[]): Promise<void> {
		const targets: string[] = [];
		const stagedPaths: string[] = [];

		for (const file of vsixFiles) {
			const matched = realPaths.find(candidate => path.basename(candidate).toLowerCase() === file.name.toLowerCase());
			if (matched) {
				targets.push(matched);
			} else {
				const staged = await stageDroppedFile(file);
				stagedPaths.push(staged);
				targets.push(staged);
			}
		}

		try {
			await this.commandService.executeCommand(INSTALL_VSIX_COMMAND_ID, ...targets.map(p => URI.file(p)));
		} finally {
			await discardStagedFiles(stagedPaths);
		}
	}

	/**
	 * 无真实路径时的 `.code-workspace` 兜底。
	 *
	 * 两条注意：
	 * 1. `.code-workspace` 是 **JSONC**（允许注释/尾逗号），必须用 VSCode 的 JSONC 解析器，
	 *    `JSON.parse` 会直接抛（"Expected double-quoted property name"）。
	 * 2. 相对 folders 需要「原文件所在目录」才能还原。OS 没给 `text/uri-list` 时拿不到，
	 *    于是让用户指定一次目录（VSCode 桌面版有真实路径，不受这个限制）。
	 */
	private async _openWorkspaceFromDroppedFile(file: File, event: DragEvent): Promise<void> {
		logDropDiagnostics('code-workspace fallback', event);

		const errors: ParseError[] = [];
		let folders: unknown;
		try {
			const parsed = parse(await file.text(), errors) as { folders?: unknown } | undefined;
			folders = parsed?.folders;
		} catch (error) {
			errors.push({ error: ParseErrorCode.InvalidSymbol, offset: 0, length: 0 } as ParseError);
			folders = undefined;
			console.error('[ScCode] Failed to read dropped workspace file:', getErrorMessage(error));
		}

		if (errors.length > 0) {
			this.notificationService.warn(
				localize(
					'sc-code.dropWorkspace.unreadable',
					"Dropped '{0}' is not a readable workspace file: {1}",
					file.name,
					getParseErrorMessage(errors[0].error)
				)
			);
			return;
		}

		const paths = (Array.isArray(folders) ? folders : [])
			.map(folder => (folder && typeof (folder as { path?: unknown }).path === 'string' ? (folder as { path: string }).path : ''))
			.filter(candidate => candidate.length > 0);

		if (paths.length === 0) {
			this.notificationService.warn(
				localize('sc-code.dropWorkspace.noFolders', "Dropped workspace '{0}' does not list any folders.", file.name)
			);
			return;
		}

		logDropDiagnostics('code-workspace fallback', event, `folders=${paths.join('|')}`);

		// 全是绝对路径：把内容原样落成一份「稳定路径的临时 workspace」，再按文件打开。
		// ⚠️ 不能 `openWindow(paths.map(folderUri))`：web 版 `BrowserHostService.doOpenWindow()` 对多个
		// folderUri 是**逐个** `doOpen()`，同一个窗口被反复导航 → 最后只剩下一个目录（用户实测）。
		// 按 workspaceUri 打开则由平台完整解析 folders + settings：多根、设置、名称都不丢。
		if (paths.every(isAbsolutePath)) {
			const stagedWorkspace = await stageDroppedWorkspaceFile(file);
			await this.hostService.openWindow([{ workspaceUri: URI.file(stagedWorkspace) }]);
			return;
		}

		// 含相对路径：相对路径只能相对「workspace 文件所在目录」解析，而 HTML5 drop 拿不到它。
		// 让用户重新定位这个 .code-workspace 文件（文件对话框能拿到真实路径），然后**按文件**打开——
		// 这样 settings / 相对 folders / 多根结构全部由平台还原，与 VSCode 桌面版完全一致，
		// 而不是我们拿 folders 拼一个丢了设置的近似工作区。
		const located = await this._locateWorkspaceFile(file);
		if (!located) {
			return; // 用户取消
		}

		await this.hostService.openWindow([{ workspaceUri: located }]);
	}

	/** 通知里给一个「定位 workspace 文件」按钮（只在拿不到原文件路径、且 workspace 用相对路径时出现） */
	private _locateWorkspaceFile(file: File): Promise<URI | undefined> {
		return new Promise<URI | undefined>(resolve => {
			let settled = false;
			const settle = (value?: URI): void => {
				if (!settled) {
					settled = true;
					resolve(value);
				}
			};

			void this.notificationService.prompt(
				Severity.Info,
				localize(
					'sc-code.dropWorkspace.relative',
					"'{0}' uses relative folder paths, and a dropped file's location is not available to the system. Locate the workspace file to open it exactly.",
					file.name
				),
				[{
					label: localize('sc-code.dropWorkspace.locateFile', 'Locate File…'),
					run: () => {
						void (async () => {
							try {
								const picked = await this.fileDialogService.showOpenDialog({
									title: localize('sc-code.dropWorkspace.locateFileTitle', "Select '{0}'", file.name),
									canSelectFiles: true,
									canSelectFolders: false,
									canSelectMany: false,
									filters: [{ name: 'Workspace', extensions: ['code-workspace'] }]
								});
								settle(picked?.[0]);
							} catch {
								settle(undefined);
							}
						})();
					}
				}],
				{ sticky: true, onCancel: () => settle(undefined) }
			);
		});
	}
}

/** 无磁盘路径时把拖入的文件写进临时目录，返回落地路径 */
async function stageDroppedFile(file: File): Promise<string> {
	const { invoke } = await import('@tauri-apps/api/core');
	const { tempDir, join } = await import('@tauri-apps/api/path');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const target = await join(await tempDir(), `sc-code-drop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`);
	await invoke('write_file_bytes', { path: target, content: Array.from(bytes) });
	return target;
}

/**
 * 把拖入的 `.code-workspace` 内容原样写到应用数据目录下，返回落盘路径。
 *
 * - 目录按**内容哈希**命名（`<user-data>/workspaces/dropped-<hash>/`），同样的内容反复拖入会复用同一份，
 *   窗口的 workspace 身份因此保持稳定（最近打开、工作区状态都还有意义）。
 * - 文件名保留原文件名 → 窗口标题、最近列表里显示的名字与原文件一致。
 * - 为什么要绕这一圈：拿不到原文件路径时，直接 `openWindow([{folderUri}…])` 会被 web 版
 *   `BrowserHostService.doOpenWindow()` 逐个导航（只剩最后一个目录）；而按 `workspaceUri` 打开
 *   能让平台完整解析 folders/settings，多根与设置都不丢。
 * - 只用于 folders 全为绝对路径的 workspace；含相对路径时相对基准未知，走「Locate File…」。
 */
async function stageDroppedWorkspaceFile(file: File): Promise<string> {
	const { invoke } = await import('@tauri-apps/api/core');
	const { join } = await import('@tauri-apps/api/path');

	const content = await file.text();
	const baseDir = await invoke<string>('get_user_data_dir');
	const targetDir = await join(baseDir, 'workspaces', `dropped-${hash(content).toString(16)}`);

	await invoke('mkdir', { path: targetDir, recursive: true });
	const target = await join(targetDir, file.name);
	await invoke('write_file', { path: target, content });

	return target;
}

/**
 * 拖拽事件里能拿到的磁盘路径：优先 `File.path`（Electron 私有，WebView2 恒为 undefined），
 * 其次 `text/uri-list`（Windows 的 Chromium/WebView2 对 OS 文件拖拽通常会带，见
 * `extractFileUrisFromDragEvent`）。两者都拿不到时返回空数组 → 调用方走「临时副本」退路。
 */
function droppedFilePaths(event: DragEvent): string[] {
	const fromFiles = Array.from(event.dataTransfer?.files ?? [])
		.map(file => (file as File & { path?: string }).path)
		.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
	if (fromFiles.length > 0) {
		return fromFiles;
	}

	return extractFileUrisFromDragEvent(event).map(uri => uri.fsPath);
}

/** 拖放落点是否在编辑器标签栏（决定 .code-workspace 是「按文件打开」还是「按工作区打开」） */
function isInsideTabsContainer(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('.tabs-container') !== null;
}

function isAbsolutePath(candidate: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\') || candidate.startsWith('/');
}

/**
 * 拿不到真实路径时，把本次拖拽的实际数据写进**日志文件**（dev 构建）。
 * 注意：webview 的 `console.*` / `ILogService` 都不会进 `ScCode.log`，只有 `plugin:log|log` 这条路由
 * 能落盘（见 pitfalls #6/#14/#18），所以这里走原始 IPC（= `@tauri-apps/plugin-log` 的 `log()` 实现）。
 */
function logDropDiagnostics(reason: string, event: DragEvent, extra?: string): void {
	void (async () => {
		try {
			const dataTransfer = event.dataTransfer;
			const files = Array.from(dataTransfer?.files ?? []);
			let uriList = '';
			try {
				uriList = dataTransfer?.getData('text/uri-list') ?? '';
			} catch {
				uriList = '<blocked>';
			}
			const message = `[drop-diag] ${reason} types=[${Array.from(dataTransfer?.types ?? []).join(',')}]`
				+ ` files=${files.length}(${files.map(file => `${file.name}:path=${(file as File & { path?: string }).path ?? 'undef'}`).join('|')})`
				+ ` uri-list=${JSON.stringify(uriList.slice(0, 300))}`
				+ ` target=${(event.target as Element | null)?.className ?? ''}`
				+ (extra ? ` ${extra}` : '');

			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('plugin:log|log', { level: 3, message }); // 3 = Info（见 tauri-plugin-log 的 LogLevel）
		} catch {
			/* 日志失败不影响功能 */
		}
	})();
}

/** 安装完成后删掉临时落地的副本（尽力而为，失败不影响安装结果） */
async function discardStagedFiles(stagedPaths: string[]): Promise<void> {
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		for (const stagedPath of stagedPaths) {
			try {
				await invoke('remove', { path: stagedPath, recursive: false });
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* ignore */
	}
}



if (isScCodeTauri) {
	registerWorkbenchContribution2(
		InstallVsixOnDropContribution.ID,
		InstallVsixOnDropContribution,
		WorkbenchPhase.AfterRestored
	);
}
