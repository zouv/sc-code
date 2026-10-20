/*---------------------------------------------------------------------------------------------
 *  ScCode — Tauri-based VSCode port
 *  Entry point. Globals set by inline script in index.html.
 *--------------------------------------------------------------------------------------------*/

import { loadNlsMessages } from './nls-loader.js';

// [CUSTOM-BEGIN] CUSTOM-20261013-001 - 自定义模块挂载点（VSIX 安装等功能）
// 必须在 workbench `create()` 之前完成导入：命令/菜单注册与 registerWorkbenchContribution2
// 都依赖「创建前注册」。模块内部自带 __SC_CODE_TAURI__ 守卫，非 Tauri 环境不会注册任何东西。
import './sc-code/vsix-install/vsixInstall.contribution.js';
// [CUSTOM-END] CUSTOM-20261013-001

// [CUSTOM-BEGIN] CUSTOM-20261014-001 - 补注册移植缺口 IAccessibleViewInformationService
// 必须在任何 ViewPane 被创建之前注册，否则 `type: "tree"` 的扩展视图会在构造时抛
// "TreeViewPane depends on UNKNOWN service accessibleViewInformationService"，容器打不开。
import './sc-code/accessibility/accessibleViewInformationService.contribution.js';
// [CUSTOM-END] CUSTOM-20261014-001

// [CUSTOM-BEGIN] CUSTOM-20261015-003 - 启动时把磁盘扩展同步进当前 profile（dev/release origin 隔离修复）
import './sc-code/extension-sync/extensionSync.contribution.js';
// [CUSTOM-END] CUSTOM-20261015-003

async function scCodeOpenFolder() {
	try {
		const { open } = await import('@tauri-apps/plugin-dialog');
		const { URI } = await import('./vs/base/common/uri.js');
		const selected = await open({ directory: true, multiple: false });
		if (selected && typeof selected === 'string') {
			navigateToFolder(URI.file(selected).toString());
		}
	} catch (e) {
		console.error('[ScCode] Failed to open folder picker:', e);
	}
}
(window as any).__sc_code_openFolder = scCodeOpenFolder;

// [CUSTOM-BEGIN] CUSTOM-20261013-004 - 支持文件夹与 .code-workspace 的 URL 路由
function navigateToWorkspace(uri: string, type: 'folder' | 'workspace') {
	const url = new URL(window.location.href);
	const parameter = type === 'folder' ? 'folder' : 'workspace';
	const staleParameter = type === 'folder' ? 'workspace' : 'folder';
	url.searchParams.set(parameter, uri);
	url.searchParams.delete(staleParameter);
	window.location.href = url.toString();
}

function navigateToFolder(folderUri: string) {
	navigateToWorkspace(folderUri, 'folder');
}
// [CUSTOM-END] CUSTOM-20261013-004

async function boot() {
	// Load locale translations before any VS Code module imports
	await loadNlsMessages();

	await Promise.all([
		import('./vs/workbench/workbench.common.main.js').catch(e => {
			console.error('[ScCode] Barrel "common" failed:', e);
			throw e;
		}),
		import('./vs/workbench/browser/web.main.js').catch(e => {
			console.error('[ScCode] Barrel "web.main" failed:', e);
			throw e;
		}),
		import('./vs/workbench/browser/parts/dialogs/dialog.web.contribution.js').catch(e => {
			console.error('[ScCode] Barrel "web-dialog" failed:', e);
			throw e;
		}),
		import('./vs/workbench/workbench.web.main.js').catch(e => {
			console.error('[ScCode] Barrel "web-services" failed:', e);
			throw e;
		})
	]);

	// ScCode Rust bridge initialization — make services available before workbench creation
	if ((globalThis as any).__SC_CODE_TAURI__) {
		const {
			ScCodeEditorBridge,
			ScCodeSyntaxService,
			ScCodeGitService,
			ScCodeSearchService,
			ScCodeSettingsService,
			ScCodeThemeService,
			ScCodeExtensionService,
			ScCodeKeymapService,
			ScCodeFileSystemProvider
		} = await import('./vs/platform/scCode/common/scCodeServices.js');

		(globalThis as any).__SC_CODE_SERVICES__ = {
			editor: ScCodeEditorBridge.getInstance(),
			syntax: new ScCodeSyntaxService(),
			git: new ScCodeGitService(),
			search: new ScCodeSearchService(),
			settings: new ScCodeSettingsService(),
			theme: new ScCodeThemeService(),
			extensions: new ScCodeExtensionService(),
			keymap: new ScCodeKeymapService(),
			fileSystem: new ScCodeFileSystemProvider()
		};

		console.log('[ScCode] Rust bridge services initialized');
	}

	const { create } = await import('./vs/workbench/browser/web.factory.js');
	const { URI } = await import('./vs/base/common/uri.js');

	if (document.readyState === 'loading') {
		await new Promise<void>(r => window.addEventListener('DOMContentLoaded', () => r()));
	}

	const urlParams = new URLSearchParams(window.location.search);
	// [CUSTOM-BEGIN] CUSTOM-20261013-004 - 初始化支持单文件夹和多根工作区
	const folderParam = urlParams.get('folder');
	const workspaceParam = urlParams.get('workspace');
	const activeWorkspaceParam = workspaceParam || folderParam;

	let workspace: any = undefined;
	if (activeWorkspaceParam) {
		const parsed = URI.parse(activeWorkspaceParam);
		if (parsed.scheme === 'file' || parsed.scheme === 'vscode-remote' || parsed.scheme === 'vscode-vfs') {
			workspace = workspaceParam ? { workspaceUri: parsed } : { folderUri: parsed };
		}
	}
	// [CUSTOM-END] CUSTOM-20261013-004

    if ((globalThis as any).__SC_CODE_TAURI__ && workspace) {
        const { invoke } = await import('@tauri-apps/api/core');
        const roots: string[] = [];
        if (workspace.folderUri?.scheme === 'file') { roots.push(workspace.folderUri.fsPath); }
        if (workspace.workspaceUri?.scheme === 'file') {
            try {
                const { parse, ParseOptions } = await import('./vs/base/common/json.js');
                const { dirname, resolvePath } = await import('./vs/base/common/resources.js');
                const content = await invoke<string>('read_file', { path: workspace.workspaceUri.fsPath });
                const config = parse(content, [], { ...ParseOptions.DEFAULT, allowTrailingComma: true });
                for (const folder of config?.folders || []) {
                    const uri = typeof folder.path === 'string'
                        ? resolvePath(dirname(workspace.workspaceUri), folder.path)
                        : typeof folder.uri === 'string' ? URI.parse(folder.uri) : undefined;
                    if (uri?.scheme === 'file') { roots.push(uri.fsPath); }
                }
            } catch (error) { console.warn('[ScCode] Workspace asset roots unavailable:', error); }
        }
        if (roots.length) {
            try { await invoke('authorize_workspace_assets', { roots }); }
            catch (error) { console.warn('[ScCode] Workspace assets unavailable:', error); }
        }
    }

	// [CUSTOM-BEGIN] CUSTOM-20261015-004 - About 对话框显示 ScCode 版本号（而非 VSCode 1.110.0）
	// ⚠️ productConfiguration.version 必须保持 '1.110.0'：它同时用于扩展 engines.vscode 兼容性校验
	//（webExtensionsScannerService → validateExtensionManifest），改成 0.1.3-custom.4 会让
	// VAC(^1.85.0)/Claude Code(^1.94.0) 被判 DisabledByInvalidExtension，扩展视图全部失效。
	// 真正的 ScCode 版本号放到全局 __SC_CODE_VERSION__，由 About 对话框读取。
	let scCodeVersion = '0.1.2';
	if ((globalThis as any).__SC_CODE_TAURI__) {
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			scCodeVersion = await getVersion();
		} catch {
			// 取不到版本时回退到 productConfiguration 值
		}
	}
	(globalThis as any).__SC_CODE_VERSION__ = scCodeVersion;
	// [CUSTOM-END] CUSTOM-20261015-004

	const options: any = {
		initialColorTheme: {
			themeType: 'dark'
		},

		additionalTrustedDomains: ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com'],

		// The workspace provider tells VSCode what folder/workspace to open
		workspaceProvider: {
			workspace,
			trusted: true,
			open: async (_workspace: any, _options: any) => {
				// [CUSTOM-BEGIN] CUSTOM-20261013-004 - provider 可重载打开 .code-workspace
				if (_workspace && 'folderUri' in _workspace) {
					navigateToWorkspace(_workspace.folderUri.toString(), 'folder');
				} else if (_workspace && 'workspaceUri' in _workspace) {
					navigateToWorkspace(_workspace.workspaceUri.toString(), 'workspace');
				}
				// [CUSTOM-END] CUSTOM-20261013-004
				return true;
			}
		},
		windowIndicator: {
			// [CUSTOM-BEGIN] CUSTOM-20261013-004 - 标题使用当前工作区 URI
			label: activeWorkspaceParam ? decodeURIComponent(activeWorkspaceParam.split('/').pop() || 'ScCode') : 'ScCode',
			// [CUSTOM-END] CUSTOM-20261013-004
			tooltip: 'ScCode — Tauri Code Editor',
			command: undefined
		},
		productConfiguration: {
			nameShort: 'ScCode',
			nameLong: 'ScCode',
			applicationName: 'sc-code',
			dataFolderName: '.sc-code',
			version: '1.110.0',
			linkProtectionTrustedDomains: ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com']
		},
		settingsSyncOptions: {
			enabled: false
		},
		additionalBuiltinExtensions: [],
		configurationDefaults: {
			'workbench.startupEditor': 'welcomePage',
			'workbench.enableExperiments': false,
			'workbench.iconTheme': 'vs-seti',
			'workbench.colorTheme': 'Dark Modern',
			'editor.experimentalGpuAcceleration': 'auto',
			'workbench.productIconTheme': 'Default',
			'workbench.editor.showTabs': 'multiple',
			'workbench.editor.enablePreview': false,
			'workbench.editor.tabCloseButton': 'right',
			'window.menuBarVisibility': navigator.userAgent.includes('Mac') ? 'hidden' : 'classic',
			'window.titleBarStyle': 'custom',
			'window.commandCenter': true,
			'scm.defaultViewMode': 'list',
			'telemetry.telemetryLevel': 'off',
			'update.mode': 'none',
			'update.showReleaseNotes': false,
			'extensions.autoUpdate': false,
			'extensions.autoCheckUpdates': false,
			'extensions.autoRestart': true,
			'workbench.settings.enableNaturalLanguageSearch': false,
			'chat.editor.enabled': false,
			'chat.commandCenter.enabled': false,
			'editor.bracketPairColorization.enabled': true,
			'editor.guides.bracketPairs': true,
			'editor.linkedEditing': true,
			'editor.suggest.showStatusBar': true,
			'editor.inlineSuggest.enabled': true,
			'editor.stickyScroll.enabled': true,
			'editor.minimap.enabled': false,
			'terminal.integrated.defaultProfile.osx': 'zsh',
			'terminal.integrated.defaultProfile.linux': 'bash',
			'terminal.integrated.profiles.osx': {
				zsh: { path: 'zsh', args: ['-l'] },
				bash: { path: 'bash', args: ['-l'], icon: 'terminal-bash' },
				fish: { path: 'fish', args: ['-l'] },
				tmux: { path: 'tmux', icon: 'terminal-tmux' },
				pwsh: { path: 'pwsh', icon: 'terminal-powershell' }
			},
			'terminal.integrated.profiles.linux': {
				bash: { path: 'bash', args: ['-l'], icon: 'terminal-bash' },
				zsh: { path: 'zsh', args: ['-l'] },
				fish: { path: 'fish', args: ['-l'] },
				tmux: { path: 'tmux', icon: 'terminal-tmux' },
				pwsh: { path: 'pwsh', icon: 'terminal-powershell' }
			},
			'terminal.integrated.enablePersistentSessions': false,
			'editor.formatOnPaste': false,
			'editor.renderWhitespace': 'selection',
			'editor.smoothScrolling': false,
			'editor.cursorBlinking': 'smooth',
			'editor.cursorSmoothCaretAnimation': 'off',
			'editor.mouseWheelZoom': true,
			'editor.wordWrap': 'off',
			'editor.suggest.preview': true,
			'editor.parameterHints.enabled': true,
			'editor.hover.enabled': true,
			'editor.folding': true,
			'editor.foldingImportsByDefault': true,
			'editor.showFoldingControls': 'mouseover',
			'editor.glyphMargin': true,
			'editor.lightbulb.enabled': 'on',
			'editor.colorDecorators': true,
			'editor.renderLineHighlight': 'all',
			'editor.matchBrackets': 'always',
			'editor.occurrencesHighlight': 'singleFile',
			'workbench.editor.highlightModifiedTabs': true,
			'workbench.tree.renderIndentGuides': 'always',
			'security.workspace.trust.startupPrompt': 'never',
			'security.workspace.trust.banner': 'never',
			'security.workspace.trust.enabled': false
		}
	};

	const workbenchContainer = document.getElementById('workbench');
	if (workbenchContainer) {
		create(workbenchContainer, options);
	} else {
		create(document.body, options);
	}

	setupTauriExternalOpener();
	setupMenuActions();
	setupWindowStateSave();
	setupNativeWindowDragging();
	setupWindowsEditorNewlineKeybindings();
	updateNativeMenuLabels();

	console.log(
		// [CUSTOM-BEGIN] CUSTOM-20261013-004 - 诊断输出覆盖文件夹及 workspace URI
		'[ScCode] Workbench created' + (activeWorkspaceParam ? ` (workspace: ${activeWorkspaceParam})` : ' (no workspace)'),
		// [CUSTOM-END] CUSTOM-20261013-004
		'workspace:',
		workspace
	);
}

function setupTauriExternalOpener() {
	import('@tauri-apps/plugin-shell')
		.then(shell => {
			(window as any).__sc_code_shellOpen = (url: string) => {
				shell.open(url).catch(() => {});
			};
		})
		.catch(() => {});
}

function setupWindowStateSave() {
	import('@tauri-apps/api/core')
		.then(({ invoke }) => {
			let saveTimer: ReturnType<typeof setTimeout> | null = null;
			const debouncedSave = () => {
				if (saveTimer) {
					clearTimeout(saveTimer);
				}
				saveTimer = setTimeout(() => {
					invoke('save_window_state', { label: 'main' }).catch(() => {});
				}, 500);
			};

			window.addEventListener('resize', debouncedSave);
			window.addEventListener('beforeunload', () => {
				invoke('save_window_state', { label: 'main' }).catch(() => {});
			});
		})
		.catch(() => {});
}

const TITLEBAR_NO_DRAG_SELECTOR =
	'a, button, input, select, textarea, [contenteditable="true"], [draggable="true"], ' +
	'.action-item, .command-center, .window-controls-container, .window-icon, ' +
	'.menubar, .monaco-menu, .monaco-action-bar, .window-title, .action-toolbar-container, ' +
	'.center-adjacent-toolbar-container, .tabs-container, .tab, .monaco-list, .pane-header, ' +
	'.composite.title, .split-view-view, .editor-group-container';

function setupNativeWindowDragging() {
	let appWindow: { startDragging(): Promise<void> } | null = null;
	import('@tauri-apps/api/window')
		.then(mod => {
			appWindow = mod.getCurrentWindow();
		})
		.catch(() => {});

	document.addEventListener('mousedown', (e: MouseEvent) => {
		if (e.button !== 0 || e.defaultPrevented || !appWindow) {
			return;
		}
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.part.titlebar')) {
			return;
		}
		if (target.closest(TITLEBAR_NO_DRAG_SELECTOR)) {
			return;
		}
		appWindow.startDragging().catch(() => {});
	});
}

function setupWindowsEditorNewlineKeybindings() {
	if (!navigator.userAgent.includes('Windows')) {
		return;
	}

	window.addEventListener('keydown', event => {
		if (event.defaultPrevented || event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.metaKey) {
			return;
		}

		const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
		if (!(target instanceof HTMLElement) || !target.closest('.monaco-editor')) {
			return;
		}

		const commandService = (
			window as { __sc_code_commandService?: { executeCommand(commandId: string): Promise<unknown> } }
		).__sc_code_commandService;
		if (!commandService) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const commandId = event.shiftKey ? 'editor.action.insertLineBefore' : 'editor.action.insertLineAfter';
		commandService.executeCommand(commandId).catch(error => {
			console.error(`[ScCode] Failed to execute ${commandId}:`, error);
		});
	});
}

function setupMenuActions() {
	const menuToCommand: Record<string, string> = {
		// File
		new_file: 'workbench.action.files.newUntitledFile',
		new_window: 'workbench.action.newWindow',
		open_file: 'workbench.action.files.openFile',
		open_folder: 'workbench.action.files.openFolder',
		save: 'workbench.action.files.save',
		save_as: 'workbench.action.files.saveAs',
		save_all: 'workbench.action.files.saveAll',
		close_editor: 'workbench.action.closeActiveEditor',
		close_window: 'workbench.action.closeWindow',
		// Edit
		find: 'actions.find',
		replace: 'editor.action.startFindReplaceAction',
		find_in_files: 'workbench.action.findInFiles',
		replace_in_files: 'workbench.action.replaceInFiles',
		// Selection
		expand_selection: 'editor.action.smartSelect.expand',
		shrink_selection: 'editor.action.smartSelect.shrink',
		copy_line_up: 'editor.action.copyLinesUpAction',
		copy_line_down: 'editor.action.copyLinesDownAction',
		move_line_up: 'editor.action.moveLinesUpAction',
		move_line_down: 'editor.action.moveLinesDownAction',
		add_cursor_above: 'editor.action.insertCursorAbove',
		add_cursor_below: 'editor.action.insertCursorBelow',
		select_all_occurrences: 'editor.action.selectHighlights',
		// View
		command_palette: 'workbench.action.showCommands',
		explorer: 'workbench.view.explorer',
		search: 'workbench.view.search',
		source_control: 'workbench.view.scm',
		debug: 'workbench.view.debug',
		extensions: 'workbench.view.extensions',
		problems: 'workbench.actions.view.problems',
		output: 'workbench.action.output.toggleOutput',
		terminal: 'workbench.action.terminal.toggleTerminal',
		debug_console: 'workbench.debug.action.toggleRepl',
		toggle_fullscreen: 'workbench.action.toggleFullScreen',
		zoom_in: 'workbench.action.zoomIn',
		zoom_out: 'workbench.action.zoomOut',
		reset_zoom: 'workbench.action.zoomReset',
		// Go
		back: 'workbench.action.navigateBack',
		forward: 'workbench.action.navigateForward',
		go_to_file: 'workbench.action.quickOpen',
		go_to_symbol: 'workbench.action.showAllSymbols',
		go_to_line: 'workbench.action.gotoLine',
		go_to_definition: 'editor.action.revealDefinition',
		go_to_references: 'editor.action.goToReferences',
		// Run
		start_debugging: 'workbench.action.debug.start',
		run_without_debugging: 'workbench.action.debug.run',
		stop_debugging: 'workbench.action.debug.stop',
		restart_debugging: 'workbench.action.debug.restart',
		toggle_breakpoint: 'editor.debug.action.toggleBreakpoint',
		// Terminal
		new_terminal: 'workbench.action.terminal.new',
		split_terminal: 'workbench.action.terminal.split',
		run_task: 'workbench.action.tasks.runTask',
		run_build_task: 'workbench.action.tasks.build',
		// Help
		keyboard_shortcuts: 'workbench.action.keybindingsEditor'
	};

	(window as any).__sc_code_menu_action = async (menuId: string) => {
		if (menuId === 'open_folder') {
			scCodeOpenFolder();
			return;
		}

		if (menuId === 'find') {
			const editorService = (window as any).__sc_code_editorService;
			if (editorService?.activeEditor?.typeId === 'workbench.editors.webviewInput') {
				try {
					await (window as any).__sc_code_commandService?.executeCommand('editor.action.webvieweditor.showFind');
				} catch {}
				return;
			}
		}

		const commandId = menuToCommand[menuId];
		if (!commandId) {
			console.warn(`[ScCode] Unknown menu action: ${menuId}`);
			return;
		}
		try {
			const event = new CustomEvent('sc-code-command', { detail: { commandId } });
			window.dispatchEvent(event);
		} catch (e) {
			console.error(`[ScCode] Failed to execute menu command ${commandId}:`, e);
		}
	};

	// Native menu events arrive as CustomEvents from the Rust backend
	window.addEventListener('sc-code-native-menu', ((e: CustomEvent) => {
		const menuId = e.detail;
		if (typeof menuId === 'string' && (window as any).__sc_code_menu_action) {
			(window as any).__sc_code_menu_action(menuId);
		}
	}) as EventListener);

	// Listen for command execution via keyboard shortcuts forwarded from native menu
	window.addEventListener('sc-code-command', async (e: any) => {
		const commandId = e.detail?.commandId;
		if (!commandId) {
			return;
		}
		if (
			commandId === 'workbench.action.files.openFolder' ||
			commandId === 'workbench.action.files.openFolderViaWorkspace'
		) {
			scCodeOpenFolder();
			return;
		}
		try {
			const commandService = (window as any).__sc_code_commandService;
			if (commandService) {
				await commandService.executeCommand(commandId);
			} else {
				console.warn(`[ScCode] Command service not ready, queuing: ${commandId}`);
			}
		} catch (err) {
			console.error(`[ScCode] Command ${commandId} failed:`, err);
		}
	});
}

/**
 * After NLS translations are loaded into `_VSCODE_NLS_MESSAGES`, send
 * translated labels to the Rust side so the native macOS menu bar updates.
 */
async function updateNativeMenuLabels() {
	if (!navigator.userAgent.includes('Mac')) {
		return;
	}

	const nlsMessages: string[] | undefined = (globalThis as any)._VSCODE_NLS_MESSAGES;
	if (!nlsMessages) {
		return;
	}

	// NLS key -> native menu item ID.
	// Submenu headers use the submenu IDs from lib.rs; individual items use
	// the MenuItemBuilder IDs.  Keys come from menubarControl.ts / the
	// various contribution files.
	const nlsKeyToMenuId: Record<string, string> = {
		// Submenu titles
		mFile: 'file_menu',
		mEdit: 'edit_menu',
		mSelection: 'selection_menu',
		mView: 'view_menu',
		mGoto: 'go_menu',
		mRun: 'run_menu',
		mTerminal: 'terminal_menu',
		mHelp: 'help_menu',
		// File menu items
		miNewFile: 'new_file',
		miNewWindow: 'new_window',
		miOpenFile: 'open_file',
		miSave: 'save',
		miSaveAs: 'save_as',
		miCloseEditor: 'close_editor',
		// Edit menu items
		miFind: 'find',
		miReplace: 'replace',
		miFindInFiles: 'find_in_files',
		miReplaceInFiles: 'replace_in_files',
		// View menu items
		miCommandPalette: 'command_palette',
		miToggleFullScreen: 'toggle_fullscreen',
		miZoomIn: 'zoom_in',
		miZoomOut: 'zoom_out',
		miZoomReset: 'reset_zoom',
		// Go menu items
		miBack: 'back',
		miForward: 'forward',
		miGotoFile: 'go_to_file',
		miGotoSymbolInWorkspace: 'go_to_symbol',
		miGotoLine: 'go_to_line',
		miGotoDefinition: 'go_to_definition',
		// Run menu items
		miStartDebugging: 'start_debugging',
		miRunWithoutDebugging: 'run_without_debugging',
		miStopDebugging: 'stop_debugging',
		miRestartDebugging: 'restart_debugging',
		miToggleBreakpoint: 'toggle_breakpoint',
		// Terminal menu items
		miNewTerminal: 'new_terminal',
		miSplitTerminal: 'split_terminal',
		miRunTask: 'run_task',
		miRunBuildTask: 'run_build_task',
		// Help menu items
		miWelcome: 'welcome',
		miDocumentation: 'documentation',
		miReleaseNotes: 'release_notes',
		miKeyboardShortcuts: 'keyboard_shortcuts',
		miReportIssue: 'report_issue'
	};

	try {
		const indexRes = await fetch('/nls.messages.json');
		if (!indexRes.ok) {
			return;
		}
		const nlsEntries: Array<{ key: string; msg: string }> = await indexRes.json();

		const labels: Record<string, string> = {};

		for (let i = 0; i < nlsEntries.length; i++) {
			const menuId = nlsKeyToMenuId[nlsEntries[i].key];
			if (menuId) {
				const translated = nlsMessages[i];
				if (typeof translated === 'string' && translated !== nlsEntries[i].msg) {
					labels[menuId] = translated.replace(/&&/g, '').replace(/&/g, '');
				}
			}
		}

		if (Object.keys(labels).length === 0) {
			return;
		}

		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('update_menu_labels', { labels });
	} catch (e) {
		console.warn('[ScCode] Could not update native menu labels:', e);
	}
}

boot().catch(err => {
	console.error('[ScCode] Fatal:', err);
	const container = document.createElement('div');
	container.style.cssText = 'padding:40px;color:#ccc;font-family:system-ui';
	const h2 = document.createElement('h2');
	h2.textContent = 'ScCode failed to start';
	const pre = document.createElement('pre');
	pre.style.cssText = 'color:#f88;white-space:pre-wrap';
	pre.textContent = (err as Error)?.stack || String(err);
	container.append(h2, pre);
	document.body.replaceChildren(container);
});
