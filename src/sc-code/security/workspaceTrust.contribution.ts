import { invoke } from '@tauri-apps/api/core';
import type { IExtensionService } from '../../vs/workbench/services/extensions/common/extensions.js';
import { Disposable, IDisposable } from '../../vs/base/common/lifecycle.js';
import { IWorkspaceTrustManagementService } from '../../vs/platform/workspace/common/workspaceTrust.js';
import { ILogService } from '../../vs/platform/log/common/log.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../vs/workbench/common/contributions.js';

let resolveReady: () => void;
export const whenNativeWorkspaceTrustReady = new Promise<void>(resolve => { resolveReady = resolve; });

export function registerNativeExtensionHostRecovery(
    trust: IWorkspaceTrustManagementService,
    extensions: Pick<IExtensionService, 'whenInstalledExtensionsRegistered' | 'startExtensionHosts'>,
    log: ILogService,
    enabled: () => boolean,
): IDisposable {
    let generation = 0;
    return trust.onDidChangeTrust(trusted => {
        const current = ++generation;
        if (!trusted || !enabled()) { return; }
        // Recreate failed startup promises only for the latest still-trusted generation.
        void extensions.whenInstalledExtensionsRegistered().then(async () => {
            if (current === generation && enabled() && trust.isWorkspaceTrusted()) {
                await extensions.startExtensionHosts();
            }
        }).catch(error => log.error('[WorkspaceTrust] Extension host restart failed', error));
    });
}

class NativeWorkspaceTrustContribution extends Disposable {
    static readonly ID = 'scCode.nativeWorkspaceTrust';
    constructor(
        @IWorkspaceTrustManagementService trust: IWorkspaceTrustManagementService,
        @ILogService log: ILogService,
    ) {
        super();
        let revision = 0;
        const sync = async (trusted: boolean): Promise<void> => {
            if (!(globalThis as { __SC_CODE_TAURI__?: boolean }).__SC_CODE_TAURI__) { return; }
            try {
                await invoke('workspace_set_trust', { trusted, session: (globalThis as { __SC_CODE_TRUST_SESSION__?: string }).__SC_CODE_TRUST_SESSION__, revision: ++revision });
            } catch (error) {
                // Fail closed in native; do not turn a bridge failure into a grant.
                log.warn('[WorkspaceTrust] Native authorization sync failed', error);
            }
        };
        this._register(trust.addWorkspaceTrustTransitionParticipant({ participate: sync }));
        // Canonical workspace trust is available before remote authority resolution.
        // Waiting for workspaceTrustInitialized here would deadlock resolver extensions.
        void trust.workspaceResolved.then(async () => {
            await sync(trust.isWorkspaceTrusted());
            resolveReady();
        }, error => { log.error('[WorkspaceTrust] Initialization failed', error); resolveReady(); });
        // A resolver may refine trust after the initial canonical workspace state.
        void trust.workspaceTrustInitialized.then(async () => {
            await whenNativeWorkspaceTrustReady;
            await sync(trust.isWorkspaceTrusted());
        }, error => log.error('[WorkspaceTrust] Final initialization failed', error));
    }
}
registerWorkbenchContribution2(NativeWorkspaceTrustContribution.ID, NativeWorkspaceTrustContribution, WorkbenchPhase.BlockStartup);
