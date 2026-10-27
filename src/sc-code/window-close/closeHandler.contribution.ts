/*---------------------------------------------------------------------------------------------
 *  ScCode — confirm unsaved changes before a window closes.
 *
 *  The native shell prevents every close request and asks this module to run the
 *  workbench-side prompt (Save / Don't Save / Cancel). Closing only continues when the
 *  user chooses Save (and it succeeds) or Don't Save.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../vs/base/common/lifecycle.js';
import { SaveReason } from '../../vs/workbench/common/editor.js';
import { IEditorService } from '../../vs/workbench/services/editor/common/editorService.js';
import { IDialogService } from '../../vs/platform/dialogs/common/dialogs.js';
import { IStorageService } from '../../vs/platform/storage/common/storage.js';
import { ILogService } from '../../vs/platform/log/common/log.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../vs/workbench/common/contributions.js';

const enum CloseDecision {
	Save,
	Discard,
	Cancel
}

class ScCodeCloseHandler extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'scCode.closeHandler';

	private _handling = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IDialogService private readonly dialogService: IDialogService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		if (!(globalThis as { __SC_CODE_TAURI__?: boolean }).__SC_CODE_TAURI__) {
			return;
		}
		(globalThis as { __sc_code_request_close?: () => void }).__sc_code_request_close = () => {
			void this.requestClose();
		};
		this._register({
			dispose: () => {
				delete (globalThis as { __sc_code_request_close?: () => void }).__sc_code_request_close;
			}
		});
	}

	private async requestClose(): Promise<void> {
		if (this._handling) {
			return;
		}
		this._handling = true;
		try {
			// Dirty editors as shown in the tab bar. (`IWorkingCopyService.modifiedWorkingCopies`
			// is not populated for file editors in this web port.)
			const dirty = this.editorService.editors.filter(editor => editor.isDirty());
			if (dirty.length > 0) {
				const single = dirty.length === 1 ? dirty[0].getName() : undefined;
				const { result } = await this.dialogService.prompt<CloseDecision>({
					type: 'warning',
					message: single
						? `Do you want to save the changes you made to ${single}?`
						: `Do you want to save the changes you made to ${dirty.length} files?`,
					detail: "Your changes will be lost if you don't save them.",
					buttons: [
						{ label: dirty.length > 1 ? 'Save All' : 'Save', run: () => CloseDecision.Save },
						{ label: "Don't Save", run: () => CloseDecision.Discard }
					],
					cancelButton: { label: 'Cancel', run: () => CloseDecision.Cancel }
				});
				if (result !== CloseDecision.Save && result !== CloseDecision.Discard) {
					return; // Cancel (or dismissed): keep the window open.
				}
				if (result === CloseDecision.Save) {
					const saved = await this.editorService.saveAll({ reason: SaveReason.EXPLICIT });
					if (!saved.success) {
						return; // A save failed; stay open so nothing is lost silently.
					}
				} else {
					// Don't Save: discard dirty editor state, including untitled editors.
					// Reverting unregisters their working copies so backups and serialized
					// layout entries do not bring them back on the next launch.
					try {
						await this.editorService.revertAll({ includeUntitled: true });
					} catch (error) {
						this.logService.error('[ScCode] Failed to discard unsaved editors:', error);
					}
				}
			}

			await this.storageService.flush();
		} catch (error) {
			this.logService.error('[ScCode] Close confirmation failed; keeping the window open:', error);
			return;
		} finally {
			this._handling = false;
		}

		try {
			const [{ invoke }, { getCurrentWindow }] = await Promise.all([
				import('@tauri-apps/api/core'),
				import('@tauri-apps/api/window')
			]);
			await invoke('close_window', { label: getCurrentWindow().label });
		} catch (error) {
			this.logService.error('[ScCode] Failed to close the window:', error);
		}
	}
}

registerWorkbenchContribution2(ScCodeCloseHandler.ID, ScCodeCloseHandler, WorkbenchPhase.BlockRestore);
