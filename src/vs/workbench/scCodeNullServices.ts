/*---------------------------------------------------------------------------------------------
 *  ScCode - A fast, native code editor
 *  Copyright (c) Siden Technologies, Inc. MIT Licensed.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../platform/instantiation/common/extensions.js';
import { createDecorator } from '../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../base/common/event.js';

// --- IAccessibleViewService ---
const IAccessibleViewService = createDecorator<IAccessibleViewService>('accessibleViewService');
interface IAccessibleViewService {
	readonly _serviceBrand: undefined;
	show(..._args: any[]): void;
}
class NullAccessibleViewService implements IAccessibleViewService {
	declare readonly _serviceBrand: undefined;
	show() {}
}
registerSingleton(IAccessibleViewService, NullAccessibleViewService, InstantiationType.Delayed);

// --- notebookEditorModelResolverService ---
const INotebookEditorModelResolverService = createDecorator<INotebookEditorModelResolverService>(
	'notebookEditorModelResolverService'
);
interface INotebookEditorModelResolverService {
	readonly _serviceBrand: undefined;
}
class NullNotebookEditorModelResolverService implements INotebookEditorModelResolverService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(
	INotebookEditorModelResolverService,
	NullNotebookEditorModelResolverService,
	InstantiationType.Delayed
);

// --- notebookService ---
const INotebookService = createDecorator<INotebookService>('notebookService');
interface INotebookService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeNotebookActiveKernel: Event<void>;
	readonly onDidAddNotebookDocument: Event<void>;
	readonly onDidRemoveNotebookDocument: Event<void>;
	getNotebookTextModels(): Iterable<unknown>;
	getNotebookTextModel(uri: unknown): undefined;
	getContributedNotebookTypes(resource?: unknown): readonly unknown[];
	canResolve(viewType: string): Promise<boolean>;
	hasSupportedNotebooks(resource: unknown): boolean;
	withNotebookDataProvider(viewType: string): Promise<never>;
}
// Notebooks are not ported. Callers such as the text search (NotebookSearchService) query
// these members unconditionally, so they must answer "no notebooks" rather than be missing.
class NullNotebookService implements INotebookService {
	declare readonly _serviceBrand: undefined;
	private _e = new Emitter<void>();
	readonly onDidChangeNotebookActiveKernel = this._e.event;
	readonly onDidAddNotebookDocument = this._e.event;
	readonly onDidRemoveNotebookDocument = this._e.event;
	getNotebookTextModels() {
		return [];
	}
	getNotebookTextModel() {
		return undefined;
	}
	getContributedNotebookTypes() {
		return [];
	}
	async canResolve() {
		return false;
	}
	hasSupportedNotebooks() {
		return false;
	}
	async withNotebookDataProvider(viewType: string): Promise<never> {
		throw new Error(`Notebooks are not supported (${viewType})`);
	}
}
registerSingleton(INotebookService, NullNotebookService, InstantiationType.Delayed);

// --- INotebookEditorService ---
const INotebookEditorService = createDecorator<INotebookEditorService>('notebookEditorService');
interface INotebookEditorService {
	readonly _serviceBrand: undefined;
	readonly onDidAddNotebookEditor: Event<unknown>;
	readonly onDidRemoveNotebookEditor: Event<unknown>;
	retrieveAllExistingWidgets(): readonly unknown[];
	retrieveExistingWidgetFromURI(resource: unknown): undefined;
	listNotebookEditors(): readonly unknown[];
}
class NullNotebookEditorService implements INotebookEditorService {
	declare readonly _serviceBrand: undefined;
	readonly onDidAddNotebookEditor = Event.None;
	readonly onDidRemoveNotebookEditor = Event.None;
	retrieveAllExistingWidgets() {
		return [];
	}
	retrieveExistingWidgetFromURI() {
		return undefined;
	}
	listNotebookEditors() {
		return [];
	}
}
registerSingleton(INotebookEditorService, NullNotebookEditorService, InstantiationType.Delayed);

// --- INotebookKernelService ---
const INotebookKernelService = createDecorator<INotebookKernelService>('notebookKernelService');
interface INotebookKernelService {
	readonly _serviceBrand: undefined;
}
class NullNotebookKernelService implements INotebookKernelService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookKernelService, NullNotebookKernelService, InstantiationType.Delayed);

// --- INotebookExecutionStateService ---
const INotebookExecutionStateService = createDecorator<INotebookExecutionStateService>(
	'INotebookExecutionStateService'
);
interface INotebookExecutionStateService {
	readonly _serviceBrand: undefined;
}
class NullNotebookExecutionStateService implements INotebookExecutionStateService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookExecutionStateService, NullNotebookExecutionStateService, InstantiationType.Delayed);

// --- INotebookRendererMessagingService ---
const INotebookRendererMessagingService = createDecorator<INotebookRendererMessagingService>(
	'INotebookRendererMessagingService'
);
interface INotebookRendererMessagingService {
	readonly _serviceBrand: undefined;
}
class NullNotebookRendererMessagingService implements INotebookRendererMessagingService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookRendererMessagingService, NullNotebookRendererMessagingService, InstantiationType.Delayed);

// --- INotebookCellStatusBarService ---
const INotebookCellStatusBarService = createDecorator<INotebookCellStatusBarService>('notebookCellStatusBarService');
interface INotebookCellStatusBarService {
	readonly _serviceBrand: undefined;
}
class NullNotebookCellStatusBarService implements INotebookCellStatusBarService {
	declare readonly _serviceBrand: undefined;
}
registerSingleton(INotebookCellStatusBarService, NullNotebookCellStatusBarService, InstantiationType.Delayed);

// --- IWorkbenchIssueService ---
// Without this registration, any code path that injects the issue reporter
// (e.g. PromptExtensionInstallFailureAction after a failed extension install)
// crashes with "UNKNOWN service workbenchIssueService". ScCode has no issue
// reporter window; reporting is a no-op.
import { IWorkbenchIssueService } from './contrib/issue/common/issue.js';

class NullWorkbenchIssueService implements IWorkbenchIssueService {
	declare readonly _serviceBrand: undefined;
	async openReporter(): Promise<void> {
		// no-op: ScCode does not bundle the issue reporter
	}
}
registerSingleton(IWorkbenchIssueService, NullWorkbenchIssueService, InstantiationType.Delayed);
