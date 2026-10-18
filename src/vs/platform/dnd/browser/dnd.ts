/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataTransfers } from '../../../base/browser/dnd.js';
import { DragMouseEvent } from '../../../base/browser/mouseEvent.js';
import { coalesce } from '../../../base/common/arrays.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../base/common/map.js';
import { parse } from '../../../base/common/marshalling.js';
import { Mimes } from '../../../base/common/mime.js';
import { Schemas } from '../../../base/common/network.js';
import { isNative, isWeb } from '../../../base/common/platform.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IDialogService } from '../../dialogs/common/dialogs.js';
import { IBaseTextResourceEditorInput, ITextEditorSelection } from '../../editor/common/editor.js';
import { ByteSize } from '../../files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../instantiation/common/instantiation.js';
import { extractSelection } from '../../opener/common/opener.js';
import { Registry } from '../../registry/common/platform.js';
import { IMarker } from '../../markers/common/markers.js';

//#region Editor / Resources DND

export const CodeDataTransfers = {
	EDITORS: 'CodeEditors',
	FILES: 'CodeFiles',
	SYMBOLS: 'application/vnd.code.symbols',
	MARKERS: 'application/vnd.code.diagnostics',
	NOTEBOOK_CELL_OUTPUT: 'notebook-cell-output',
	SCM_HISTORY_ITEM: 'scm-history-item'
};

export interface IDraggedResourceEditorInput extends IBaseTextResourceEditorInput {
	resource: URI | undefined;

	/**
	 * A hint that the source of the dragged editor input
	 * might not be the application but some external tool.
	 */
	isExternal?: boolean;

	/**
	 * Whether we probe for the dropped editor to be a workspace
	 * (i.e. code-workspace file or even a folder), allowing to
	 * open it as workspace instead of opening as editor.
	 */
	allowWorkspaceOpen?: boolean;
}

export function extractEditorsDropData(e: DragEvent): Array<IDraggedResourceEditorInput> {
	const editors: IDraggedResourceEditorInput[] = [];
	if (e.dataTransfer && e.dataTransfer.types.length > 0) {
		// Data Transfer: Code Editors
		const rawEditorsData = e.dataTransfer.getData(CodeDataTransfers.EDITORS);
		if (rawEditorsData) {
			try {
				editors.push(...parse(rawEditorsData));
			} catch (_error) {
				// Invalid transfer
			}
		}

		// Data Transfer: Resources
		else {
			try {
				const rawResourcesData = e.dataTransfer.getData(DataTransfers.RESOURCES);
				editors.push(...createDraggedEditorInputFromRawResourcesData(rawResourcesData));
			} catch (_error) {
				// Invalid transfer
			}
		}

		// Check for native file transfer
		if (e.dataTransfer?.files) {
			for (let i = 0; i < e.dataTransfer.files.length; i++) {
				const file = e.dataTransfer.files[i];
				if (file && getPathForFile(file)) {
					try {
						editors.push({ resource: URI.file(getPathForFile(file)!), isExternal: true, allowWorkspaceOpen: true });
					} catch (_error) {
						// Invalid URI
					}
				}
			}
		}

		// [CUSTOM-BEGIN] CUSTOM-20261017-005 - OS 文件拖入的「真实路径」来源：text/uri-list
		// 背景：SideX 关掉了 Tauri 原生拖放（`dragDropEnabled:false`，否则 webview 内 HTML5 拖拽全哑），
		// 于是 OS 文件拖入时上面那条 `getPathForFile()`（Electron `webUtils`，只在 Electron 里存在）恒为
		// 空，只剩 `extractFilesDropData()` 那条「读内容当未命名副本」的 web 退路。
		// Windows 的 Chromium/WebView2 拖入 OS 文件时通常还会带一份 `text/uri-list`（file:// URL）——
		// 这里把它当真实路径来源：拿得到就按**磁盘文件**处理，于是 ordinary file 打开真文件、
		// `.code-workspace`/文件夹在编辑区按 workspace 打开、在标签栏按普通文件打开（与 VSCode 桌面版一致）。
		// 拿不到（列表为空）时行为不变：仍走 web 的未命名副本退路。
		for (const uri of extractFileUrisFromDragEvent(e)) {
			editors.push({ resource: uri, isExternal: true, allowWorkspaceOpen: true });
		}
		// [CUSTOM-END] CUSTOM-20261017-005

		// Check for CodeFiles transfer
		const rawCodeFiles = e.dataTransfer.getData(CodeDataTransfers.FILES);
		if (rawCodeFiles) {
			try {
				const codeFiles: string[] = JSON.parse(rawCodeFiles);
				for (const codeFile of codeFiles) {
					editors.push({ resource: URI.file(codeFile), isExternal: true, allowWorkspaceOpen: true });
				}
			} catch (_error) {
				// Invalid transfer
			}
		}

		// Workbench contributions
		const contributions = Registry.as<IDragAndDropContributionRegistry>(Extensions.DragAndDropContribution).getAll();
		for (const contribution of contributions) {
			const data = e.dataTransfer.getData(contribution.dataFormatKey);
			if (data) {
				try {
					editors.push(...contribution.getEditorInputs(data));
				} catch (_error) {
					// Invalid transfer
				}
			}
		}
	}

	// Prevent duplicates: it is possible that we end up with the same
	// dragged editor multiple times because multiple data transfers
	// are being used (https://github.com/microsoft/vscode/issues/128925)

	const coalescedEditors: IDraggedResourceEditorInput[] = [];
	const seen = new ResourceMap<boolean>();
	for (const editor of editors) {
		if (!editor.resource) {
			coalescedEditors.push(editor);
		} else if (!seen.has(editor.resource)) {
			coalescedEditors.push(editor);
			seen.set(editor.resource, true);
		}
	}

	return coalescedEditors;
}

export async function extractEditorsAndFilesDropData(
	accessor: ServicesAccessor,
	e: DragEvent
): Promise<Array<IDraggedResourceEditorInput>> {
	const editors = extractEditorsDropData(e);

	// Web: Check for file transfer
	if (e.dataTransfer && isWeb && containsDragType(e, DataTransfers.FILES)) {
		// [CUSTOM-BEGIN] CUSTOM-20261017-005 - 已在 extractEditorsDropData 里从 text/uri-list 拿到真实路径
		// （`isExternal` 的 file: 资源）时，别再读文件内容造一份未命名副本，否则同一次拖入会开出两个编辑器。
		if (editors.length > 0) {
			return editors;
		}
		// [CUSTOM-END] CUSTOM-20261017-005
		const files = e.dataTransfer.items;
		if (files) {
			const instantiationService = accessor.get(IInstantiationService);
			const filesData = await instantiationService.invokeFunction(accessor => extractFilesDropData(accessor, e));
			for (const fileData of filesData) {
				editors.push({
					resource: fileData.resource,
					contents: fileData.contents?.toString(),
					// [CUSTOM-20261017-006] 快照副本以干净状态打开
					initialDirtyState: fileData.initialDirtyState,
					isExternal: true,
					allowWorkspaceOpen: fileData.isDirectory
				});
			}
		}
	}

	return editors;
}

export function createDraggedEditorInputFromRawResourcesData(
	rawResourcesData: string | undefined
): IDraggedResourceEditorInput[] {
	const editors: IDraggedResourceEditorInput[] = [];

	if (rawResourcesData) {
		const resourcesRaw: string[] = JSON.parse(rawResourcesData);
		for (const resourceRaw of resourcesRaw) {
			if (resourceRaw.indexOf(':') > 0) {
				// mitigate https://github.com/microsoft/vscode/issues/124946
				const { selection, uri } = extractSelection(URI.parse(resourceRaw));
				editors.push({ resource: uri, options: { selection } });
			}
		}
	}

	return editors;
}

interface IFileTransferData {
	resource: URI;
	isDirectory?: boolean;
	contents?: VSBuffer;
	// [CUSTOM-BEGIN] CUSTOM-20261017-006 - 这些内容只是拖入文件的快照，不是未保存修改
	/** `false` = 以「干净副本」打开（拖入文件拿不到路径时的退路），用户编辑后才算脏 */
	initialDirtyState?: boolean;
	// [CUSTOM-END] CUSTOM-20261017-006
}

async function extractFilesDropData(accessor: ServicesAccessor, event: DragEvent): Promise<IFileTransferData[]> {
	// SideX: drag/drop of filesystem handles is not supported — we use the Tauri
	// backend exclusively for file I/O. Extract any files via the standard FileList API.
	const files = event.dataTransfer?.files;
	if (!files) {
		return [];
	}

	return extractFileListData(accessor, files);
}

export async function extractFileListData(accessor: ServicesAccessor, files: FileList): Promise<IFileTransferData[]> {
	const dialogService = accessor.get(IDialogService);

	const results: DeferredPromise<IFileTransferData | undefined>[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files.item(i);
		if (file) {
			// Skip for very large files because this operation is unbuffered
			if (file.size > 100 * ByteSize.MB) {
				dialogService.warn(
					localize(
						'fileTooLarge',
						'File is too large to open as untitled editor. Please upload it first into the file explorer and then try again.'
					)
				);
				continue;
			}

			const result = new DeferredPromise<IFileTransferData | undefined>();
			results.push(result);

			const reader = new FileReader();

			reader.onerror = () => result.complete(undefined);
			reader.onabort = () => result.complete(undefined);

			reader.onload = async event => {
				const name = file.name;
				const loadResult = event.target?.result ?? undefined;
				if (typeof name !== 'string' || typeof loadResult === 'undefined') {
					result.complete(undefined);
					return;
				}

				result.complete({
					resource: URI.from({ scheme: Schemas.untitled, path: name }),
					contents:
						typeof loadResult === 'string' ? VSBuffer.fromString(loadResult) : VSBuffer.wrap(new Uint8Array(loadResult)),
					// [CUSTOM-20261017-006] 拖入文件的快照：初始干净，编辑后才标脏
					initialDirtyState: false
				});
			};

			// Start reading
			reader.readAsArrayBuffer(file);
		}
	}

	return coalesce(await Promise.all(results.map(result => result.p)));
}

//#endregion

export function containsDragType(event: DragEvent, ...dragTypesToFind: string[]): boolean {
	if (!event.dataTransfer) {
		return false;
	}

	const dragTypes = event.dataTransfer.types;
	const lowercaseDragTypes: string[] = [];
	for (let i = 0; i < dragTypes.length; i++) {
		lowercaseDragTypes.push(dragTypes[i].toLowerCase()); // somehow the types are lowercase
	}

	for (const dragType of dragTypesToFind) {
		if (lowercaseDragTypes.indexOf(dragType.toLowerCase()) >= 0) {
			return true;
		}
	}

	return false;
}

//#region DND contributions

export interface IResourceStat {
	readonly resource: URI;
	readonly isDirectory?: boolean;
	readonly selection?: ITextEditorSelection;
}

export interface IResourceDropHandler {
	/**
	 * Handle a dropped resource.
	 * @param resource The resource that was dropped
	 * @param accessor Service accessor to get services
	 * @returns true if handled, false otherwise
	 */
	handleDrop(resource: URI, accessor: ServicesAccessor): Promise<boolean>;
}

export interface IDragAndDropContributionRegistry {
	/**
	 * Registers a drag and drop contribution.
	 */
	register(contribution: IDragAndDropContribution): void;

	/**
	 * Returns all registered drag and drop contributions.
	 */
	getAll(): IterableIterator<IDragAndDropContribution>;

	/**
	 * Register a handler for dropped resources.
	 * @returns A disposable that unregisters the handler when disposed
	 */
	registerDropHandler(handler: IResourceDropHandler): IDisposable;

	/**
	 * Handle a dropped resource using registered handlers.
	 * @param resource The resource that was dropped
	 * @param accessor Service accessor to get services
	 * @returns true if any handler handled the resource, false otherwise
	 */
	handleResourceDrop(resource: URI, accessor: ServicesAccessor): Promise<boolean>;
}

interface IDragAndDropContribution {
	readonly dataFormatKey: string;
	getEditorInputs(data: string): IDraggedResourceEditorInput[];
	setData(resources: IResourceStat[], event: DragMouseEvent | DragEvent): void;
}

class DragAndDropContributionRegistry implements IDragAndDropContributionRegistry {
	private readonly _contributions = new Map<string, IDragAndDropContribution>();
	private readonly _dropHandlers = new Set<IResourceDropHandler>();

	register(contribution: IDragAndDropContribution): void {
		if (this._contributions.has(contribution.dataFormatKey)) {
			throw new Error(`A drag and drop contributiont with key '${contribution.dataFormatKey}' was already registered.`);
		}
		this._contributions.set(contribution.dataFormatKey, contribution);
	}

	getAll(): IterableIterator<IDragAndDropContribution> {
		return this._contributions.values();
	}

	registerDropHandler(handler: IResourceDropHandler): IDisposable {
		this._dropHandlers.add(handler);
		return toDisposable(() => this._dropHandlers.delete(handler));
	}

	async handleResourceDrop(resource: URI, accessor: ServicesAccessor): Promise<boolean> {
		for (const handler of this._dropHandlers) {
			if (await handler.handleDrop(resource, accessor)) {
				return true;
			}
		}
		return false;
	}
}

export const Extensions = {
	DragAndDropContribution: 'workbench.contributions.dragAndDrop'
};

Registry.add(Extensions.DragAndDropContribution, new DragAndDropContributionRegistry());

//#endregion

//#region DND Utilities

/**
 * A singleton to store transfer data during drag & drop operations that are only valid within the application.
 */
export class LocalSelectionTransfer<T> {
	private static readonly INSTANCE = new LocalSelectionTransfer();

	private data?: T[];
	private proto?: T;

	private constructor() {
		// protect against external instantiation
	}

	static getInstance<T>(): LocalSelectionTransfer<T> {
		return LocalSelectionTransfer.INSTANCE as LocalSelectionTransfer<T>;
	}

	hasData(proto: T): boolean {
		return proto && proto === this.proto;
	}

	clearData(proto: T): void {
		if (this.hasData(proto)) {
			this.proto = undefined;
			this.data = undefined;
		}
	}

	getData(proto: T): T[] | undefined {
		if (this.hasData(proto)) {
			return this.data;
		}

		return undefined;
	}

	setData(data: T[], proto: T): void {
		if (proto) {
			this.data = data;
			this.proto = proto;
		}
	}
}

export interface DocumentSymbolTransferData {
	name: string;
	fsPath: string;
	range: {
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	};
	kind: number;
}

export interface NotebookCellOutputTransferData {
	outputId: string;
}

function setDataAsJSON(e: DragEvent, kind: string, data: unknown) {
	e.dataTransfer?.setData(kind, JSON.stringify(data));
}

function getDataAsJSON<T>(e: DragEvent, kind: string, defaultValue: T): T {
	const rawSymbolsData = e.dataTransfer?.getData(kind);
	if (rawSymbolsData) {
		try {
			return JSON.parse(rawSymbolsData);
		} catch (_error) {
			// Invalid transfer
		}
	}

	return defaultValue;
}

export function extractSymbolDropData(e: DragEvent): DocumentSymbolTransferData[] {
	return getDataAsJSON(e, CodeDataTransfers.SYMBOLS, []);
}

export function fillInSymbolsDragData(symbolsData: readonly DocumentSymbolTransferData[], e: DragEvent): void {
	setDataAsJSON(e, CodeDataTransfers.SYMBOLS, symbolsData);
}

export type MarkerTransferData = IMarker | { uri: UriComponents };

export function extractMarkerDropData(e: DragEvent): MarkerTransferData[] | undefined {
	return getDataAsJSON(e, CodeDataTransfers.MARKERS, undefined);
}

export function fillInMarkersDragData(markerData: MarkerTransferData[], e: DragEvent): void {
	setDataAsJSON(e, CodeDataTransfers.MARKERS, markerData);
}

export function extractNotebookCellOutputDropData(e: DragEvent): NotebookCellOutputTransferData | undefined {
	return getDataAsJSON(e, CodeDataTransfers.NOTEBOOK_CELL_OUTPUT, undefined);
}

interface IElectronWebUtils {
	vscode?: {
		webUtils?: {
			getPathForFile(file: File): string;
		};
	};
}

/**
 * A helper to get access to Electrons `webUtils.getPathForFile` function
 * in a safe way without crashing the application when running in the web.
 */
export function getPathForFile(file: File): string | undefined {
	if (isNative && typeof (globalThis as IElectronWebUtils).vscode?.webUtils?.getPathForFile === 'function') {
		return (globalThis as IElectronWebUtils).vscode?.webUtils?.getPathForFile(file);
	}

	return undefined;
}

// [CUSTOM-BEGIN] CUSTOM-20261017-005 - 从拖拽事件里取 OS 文件的真实路径（text/uri-list，见 extractEditorsDropData）
/**
 * 拖拽事件里的 `text/uri-list`（如 `file:///c%3A/Users/a.code-workspace`）→ `file:` URI 列表。
 * 只在 Tauri/webview 里作为「Electron `getPathForFile` 的替代来源」；拿不到时返回空数组，
 * 调用方维持原有退路（未命名副本）。
 */
export function extractFileUrisFromDragEvent(e: DragEvent): URI[] {
	if (!isWeb || !e.dataTransfer) {
		return [];
	}

	let raw: string;
	try {
		// 只读标准 `text/uri-list`：这是 OS 拖拽（Explorer → webview）携带的格式。
		// 刻意不读 VSCode 自己的 `application/vnd.code.uri-list`（那是应用内拖拽用的，已有专门链路处理）。
		raw = e.dataTransfer.getData(Mimes.uriList);
	} catch {
		return []; // 某些场景（跨窗口/受保护拖拽）读取会抛
	}
	if (!raw) {
		return [];
	}

	const uris: URI[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const candidate = line.trim();
		if (!candidate || candidate.startsWith('#')) {
			continue;
		}
		try {
			const uri = URI.parse(candidate);
			if (uri.scheme === Schemas.file) {
				uris.push(uri);
			}
		} catch {
			// 非法 URI 行直接忽略
		}
	}

	return uris;
}
// [CUSTOM-END] CUSTOM-20261017-005

//#endregion
