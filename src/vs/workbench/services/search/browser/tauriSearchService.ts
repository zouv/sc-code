/*---------------------------------------------------------------------------------------------
 *  ScCode — Tauri-backed search provider.
 *  Delegates file search and text search to Rust via invoke().
 *--------------------------------------------------------------------------------------------*/

import { Channel, invoke } from '@tauri-apps/api/core';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { timeout } from '../../../../base/common/async.js';
import { IExpression } from '../../../../base/common/glob.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { Schemas } from '../../../../base/common/network.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IExtensionService } from '../../extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import {
	IFileMatch,
	IFileQuery,
	IFolderQuery,
	ISearchComplete,
	ISearchProgressItem,
	ISearchResultProvider,
	ISearchService,
	ITextQuery,
	ITextSearchCompleteMessage,
	ITextSearchMatch,
	SearchProviderType,
	SearchRange
} from '../common/search.js';
import { SearchService } from '../common/searchService.js';
import { TextSearchCompleteMessageType } from '../common/searchExtTypes.js';

/** Mirrors `commands::search::TextMatch`; columns are UTF-16 units. */
interface RustTextMatch {
	path: string;
	line_number: number;
	line_content: string;
	column: number;
	match_length: number;
	preview_column: number;
}

interface RustTextSearchSummary {
	match_count: number;
	limit_hit: boolean;
	cancelled: boolean;
}

interface RustWorkspaceFiles {
	paths: string[];
	limit_hit: boolean;
}

const DEFAULT_MAX_RESULTS = 20000;
const CHANNEL_DRAIN_TIMEOUT_MS = 2000;
let nextRequestId = 1;

/**
 * Globs that apply unconditionally. Sibling clauses (`{ when: '$(basename).ts' }`) need the
 * sibling's existence and are skipped rather than turned into unconditional excludes.
 */
function unconditionalGlobs(expression: IExpression | undefined, prefix = ''): string[] {
	if (!expression) {
		return [];
	}
	return Object.keys(expression)
		.filter(key => expression[key] === true)
		.map(key => (prefix && !key.startsWith('**/') ? `${prefix}/${key}` : key));
}

/** Folder-specific and global exclude globs, rewritten relative to the searched folder. */
function folderExcludes(query: ITextQuery | IFileQuery, fq: IFolderQuery): string[] {
	const globs = unconditionalGlobs(query.excludePattern);
	for (const entry of fq.excludePattern ?? []) {
		const prefix = entry.folder ? relativePath(fq.folder, entry.folder) : '';
		if (prefix === undefined) {
			continue; // pattern belongs to another root
		}
		globs.push(...unconditionalGlobs(entry.pattern, prefix));
	}
	return globs;
}

function folderIncludes(query: ITextQuery | IFileQuery, fq: IFolderQuery): string[] {
	return [...unconditionalGlobs(query.includePattern), ...unconditionalGlobs(fq.includePattern)];
}

function errorMessage(err: unknown): string {
	return typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
}

class TauriSearchProvider extends Disposable implements ISearchResultProvider {
	constructor(private readonly logService: ILogService) {
		super();
	}

	async getAIName(): Promise<string | undefined> {
		return undefined;
	}

	async textSearch(
		query: ITextQuery,
		onProgress?: (p: ISearchProgressItem) => void,
		token?: CancellationToken
	): Promise<ISearchComplete> {
		const results: IFileMatch[] = [];
		const messages: ITextSearchCompleteMessage[] = [];
		const maxResults = query.maxResults ?? DEFAULT_MAX_RESULTS;
		let reported = 0;
		let limitHit = false;

		for (const fq of query.folderQueries) {
			if (token?.isCancellationRequested || reported >= maxResults) {
				limitHit ||= reported >= maxResults;
				break;
			}
			const requestId = nextRequestId++;
			const cancel = token?.onCancellationRequested(() => {
				invoke('search_cancel', { requestId }).catch(() => {});
			});
			const channel = new Channel<RustTextMatch[]>();
			// Channel deliveries may trail the command's return value; reconcile on match_count.
			let received = 0;
			let expected = Number.POSITIVE_INFINITY;
			let drained: () => void = () => {};
			const allReceived = new Promise<void>(resolve => (drained = resolve));
			channel.onmessage = matches => {
				received += matches.length;
				const fileMatch = this.toFileMatch(matches);
				if (fileMatch) {
					onProgress?.(fileMatch);
					results.push(fileMatch);
				}
				if (received >= expected) {
					drained();
				}
			};
			try {
				const summary = await invoke<RustTextSearchSummary>('search_text_stream', {
					root: fq.folder.fsPath,
					query: query.contentPattern.pattern,
					requestId,
					onFile: channel,
					options: {
						max_results: maxResults - reported,
						case_sensitive: query.contentPattern.isCaseSensitive ?? false,
						is_regex: query.contentPattern.isRegExp ?? false,
						whole_word: query.contentPattern.isWordMatch ?? false,
						include: folderIncludes(query, fq),
						exclude: folderExcludes(query, fq),
						use_ignore_files: !fq.disregardIgnoreFiles,
						follow_symlinks: !fq.ignoreSymlinks,
						ignore_glob_case: fq.ignoreGlobCase ?? query.ignoreGlobCase
					}
				});
				reported += summary.match_count;
				limitHit ||= summary.limit_hit;
				expected = summary.match_count;
				if (received < expected) {
					await Promise.race([allReceived, timeout(CHANNEL_DRAIN_TIMEOUT_MS)]);
				}
			} catch (err) {
				const text = errorMessage(err);
				this.logService.error('[ScCode-Search] textSearch failed:', text);
				messages.push({ text: `${fq.folder.fsPath}: ${text}`, type: TextSearchCompleteMessageType.Warning });
			} finally {
				cancel?.dispose();
			}
		}

		return { results, limitHit, messages };
	}

	private toFileMatch(matches: RustTextMatch[]): IFileMatch | undefined {
		if (!matches.length) {
			return undefined;
		}
		const textResults: ITextSearchMatch[] = matches.map(m => {
			const line = m.line_number - 1;
			return {
				previewText: m.line_content,
				rangeLocations: [
					{
						source: new SearchRange(line, m.column, line, m.column + m.match_length),
						preview: new SearchRange(0, m.preview_column, 0, m.preview_column + m.match_length)
					}
				]
			};
		});
		return { resource: URI.file(matches[0].path), results: textResults };
	}

	async fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
		const results: IFileMatch[] = [];
		const messages: ITextSearchCompleteMessage[] = [];
		const maxResults = query.maxResults ?? DEFAULT_MAX_RESULTS;
		let limitHit = false;

		for (const fq of query.folderQueries) {
			if (token?.isCancellationRequested || results.length >= maxResults) {
				break;
			}
			const requestId = nextRequestId++;
			const cancel = token?.onCancellationRequested(() => {
				invoke('search_cancel', { requestId }).catch(() => {});
			});
			try {
				const found = await invoke<RustWorkspaceFiles>('search_workspace_files', {
					root: fq.folder.fsPath,
					pattern: query.filePattern ?? '',
					requestId,
					options: {
						max_results: query.exists ? 1 : maxResults - results.length,
						include: folderIncludes(query, fq),
						exclude: folderExcludes(query, fq),
						use_ignore_files: !fq.disregardIgnoreFiles,
						follow_symlinks: !fq.ignoreSymlinks,
						ignore_glob_case: fq.ignoreGlobCase ?? query.ignoreGlobCase
					}
				});
				for (const path of found.paths) {
					results.push({ resource: URI.file(path) });
				}
				limitHit ||= found.limit_hit;
			} catch (err) {
				const text = errorMessage(err);
				this.logService.error('[ScCode-Search] fileSearch failed:', text);
				messages.push({ text: `${fq.folder.fsPath}: ${text}`, type: TextSearchCompleteMessageType.Warning });
			} finally {
				cancel?.dispose();
			}
		}

		return { results, limitHit, messages };
	}

	async clearCache(_cacheKey: string): Promise<void> {
		// Rust search is stateless, nothing to clear
	}
}

export class TauriSearchService extends SearchService {
	constructor(
		@IModelService modelService: IModelService,
		@IEditorService editorService: IEditorService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILogService logService: ILogService,
		@IExtensionService extensionService: IExtensionService,
		@IFileService fileService: IFileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService
	) {
		super(modelService, editorService, telemetryService, logService, extensionService, fileService, uriIdentityService);

		const provider = this._register(new TauriSearchProvider(logService));
		this._register(this.registerSearchResultProvider(Schemas.file, SearchProviderType.file, provider));
		this._register(this.registerSearchResultProvider(Schemas.file, SearchProviderType.text, provider));
	}
}

registerSingleton(ISearchService, TauriSearchService, InstantiationType.Delayed);
