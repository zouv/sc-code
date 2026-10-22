/*---------------------------------------------------------------------------------------------
 *  ScCode —— 把最近打开的文件夹 / 工作区同步到 Windows 任务栏跳转列表
 *
 *  Windows 的任务栏右键菜单由应用主动写入。工作台里的最近列表保存在
 *  `workspacesService`（application storage）中，这里监听它并把条目转发给
 *  Rust 的 `taskbar_update_jump_list` 命令。
 *
 *  条目只包含本地 file: URI。点击后由 Rust 生成
 *  `ScCode.exe --open-folder=<base64>` / `--open-workspace=<base64>`；
 *  单实例插件会把参数转交给已运行的进程。非 Tauri/非 Windows 环境不注册。
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'vs/base/common/lifecycle.js';
import { ILogService } from 'vs/platform/log/common/log.js';
import { ILabelService, Verbosity } from 'vs/platform/label/common/label.js';
import {
	IRecentlyOpened,
	IRecentFolder,
	IRecentWorkspace,
	IWorkspacesService,
	isRecentFolder,
	isRecentWorkspace
} from 'vs/platform/workspaces/common/workspaces.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions.js';

const isScCodeTauri = (globalThis as any).__SC_CODE_TAURI__ === true;
const MAX_JUMP_LIST_ENTRIES = 10;
const UPDATE_DEBOUNCE_MS = 250;

interface JumpListEntry {
	readonly kind: 'folder' | 'workspace';
	readonly uri: string;
	readonly label: string;
}

class RecentJumpListContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sc-code.recentJumpList';

	private updateTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._register(
			this.workspacesService.onDidChangeRecentlyOpened(() => this.scheduleUpdate())
		);
		this._register(toDisposable(() => {
			if (this.updateTimer) {
				clearTimeout(this.updateTimer);
			}
		}));

		this.scheduleUpdate();
	}

	private scheduleUpdate(): void {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}
		this.updateTimer = setTimeout(() => {
			this.updateTimer = undefined;
			void this.update();
		}, UPDATE_DEBOUNCE_MS);
	}

	private async update(): Promise<void> {
		try {
			const recentlyOpened = await this.workspacesService.getRecentlyOpened();
			const entries = this.toEntries(recentlyOpened);
			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('taskbar_update_jump_list', { entries });
		} catch (error) {
			// Taskbar integration is best-effort; the workbench must keep working
			// when the shell API is unavailable.
			this.logService.warn(
				`[RecentJumpList] update failed: ${(error as Error)?.message ?? String(error)}`
			);
		}
	}

	private toEntries(recentlyOpened: IRecentlyOpened): JumpListEntry[] {
		const entries: JumpListEntry[] = [];

		for (const recent of recentlyOpened.workspaces) {
			if (entries.length >= MAX_JUMP_LIST_ENTRIES) {
				break;
			}
			if (isRecentFolder(recent)) {
				if (recent.folderUri.scheme === 'file') {
					entries.push({
						kind: 'folder',
						uri: recent.folderUri.toString(),
						label: this.labelForFolder(recent)
					});
				}
			} else if (isRecentWorkspace(recent)) {
				if (recent.workspace.configPath.scheme === 'file') {
					entries.push({
						kind: 'workspace',
						uri: recent.workspace.configPath.toString(),
						label: this.labelForWorkspace(recent)
					});
				}
			}
		}

		return entries;
	}

	private labelForFolder(recent: IRecentFolder): string {
		if (recent.label) {
			return recent.label;
		}
		try {
			return this.labelService.getWorkspaceLabel(recent.folderUri, { verbose: Verbosity.MEDIUM });
		} catch {
			return recent.folderUri.path;
		}
	}

	private labelForWorkspace(recent: IRecentWorkspace): string {
		if (recent.label) {
			return recent.label;
		}
		try {
			return this.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.MEDIUM });
		} catch {
			return recent.workspace.configPath.path;
		}
	}
}

if (isScCodeTauri) {
	registerWorkbenchContribution2(
		RecentJumpListContribution.ID,
		RecentJumpListContribution,
		WorkbenchPhase.AfterRestored
	);
}
