/*---------------------------------------------------------------------------------------------
 *  ScCode —— 启动时把磁盘扩展同步进当前 profile 的已安装列表
 *
 *  为什么需要这个模块：
 *  ScCode 前端跑在 Web 模式，扩展的「已安装」记录由 web 扩展扫描器维护，而这份记录按
 *  origin 隔离：dev 是 http://localhost:1420，release 是 https://tauri.localhost。
 *  扩展本体在磁盘 %APPDATA%\ScCode\extensions（Rust 后端扫描并激活），但扩展视图列表与
 *  活动栏图标 / 视图容器（contributes.viewsContainers / contributes.views）只认当前
 *  origin 的记录。因此在 dev 里安装的扩展，装到 release 包后看不到。
 *
 *  本模块在启动时读 Rust 的 list_installed_extensions（磁盘真实安装），把当前 profile
 *  尚未登记的扩展经 installFromLocation 幂等补登记 —— 复用 VSIX 安装链路
 *  （CUSTOM-20261013-001），让 dev / release 之间切换保持一致。
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri.js';
import { Disposable } from 'vs/base/common/lifecycle.js';
import { ExtensionType } from 'vs/platform/extensions/common/extensions.js';
import { ILogService } from 'vs/platform/log/common/log.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions.js';
import { IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement.js';
import { IUserDataProfileService } from 'vs/workbench/services/userDataProfile/common/userDataProfile.js';

const isScCodeTauri = (globalThis as any).__SC_CODE_TAURI__ === true;

/** Rust `list_installed_extensions` 返回项（见 src-tauri/src/commands/extensions.rs） */
interface DiskExtension {
	id: string;
	name: string;
	version: string;
	path: string;
}

class ExtensionSyncContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sc-code.extensionSync';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IUserDataProfileService private readonly userDataProfileService: IUserDataProfileService
	) {
		super();
		void this.syncDiskExtensions();
	}

	private async syncDiskExtensions(): Promise<void> {
		if (!isScCodeTauri) {
			return;
		}
		const { isRealExtensionHostEnabled } = await import('vs/workbench/services/extensions/browser/tauriProcessExtensionHost.js');
		if (isRealExtensionHostEnabled()) {
			// The extension service registers disk extensions before its first
			// scan when the real host is enabled; doing it here as well would
			// duplicate the work after restore.
			return;
		}
		try {
			const { invoke } = await import('@tauri-apps/api/core');
			const disk = (await invoke<DiskExtension[]>('list_installed_extensions')) ?? [];
			if (disk.length === 0) {
				return;
			}

			const server = this.extensionManagementServerService.webExtensionManagementServer;
			if (!server) {
				return;
			}
			const profileLocation = this.userDataProfileService.currentProfile.extensionsResource;

			const installed = await server.extensionManagementService.getInstalled(ExtensionType.User, profileLocation);
			const installedIds = new Set(installed.map(extension => extension.identifier.id.toLowerCase()));

			for (const extension of disk) {
				if (!extension?.path || installedIds.has(extension.id.toLowerCase())) {
					continue;
				}
				try {
					await server.extensionManagementService.installFromLocation(URI.file(extension.path), profileLocation);
					this.logService.info(`[ExtSync] registered disk extension ${extension.id} (${extension.version})`);
				} catch (error) {
					this.logService.warn(`[ExtSync] failed to register ${extension.id}: ${(error as Error)?.message ?? String(error)}`);
				}
			}
		} catch (error) {
			this.logService.warn(`[ExtSync] sync failed: ${(error as Error)?.message ?? String(error)}`);
		}
	}
}

if (isScCodeTauri) {
	registerWorkbenchContribution2(
		ExtensionSyncContribution.ID,
		ExtensionSyncContribution,
		WorkbenchPhase.AfterRestored
	);
}
