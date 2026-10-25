/*---------------------------------------------------------------------------------------------
 *  ScCode — Tauri-backed file system provider.
 *  Handles `file` and `vscode-file` schemes by delegating all I/O to the
 *  Rust backend via `invoke()` from @tauri-apps/api/core.
 *--------------------------------------------------------------------------------------------*/

import { Channel, invoke } from '@tauri-apps/api/core';
import { isWindows } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import {
	FileChangeType,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	createFileSystemProviderError,
	IFileChange,
	IFileDeleteOptions,
	IFileOverwriteOptions,
	IFileWriteOptions,
	IStat,
	IWatchOptions,
	IFileSystemProviderWithFileReadWriteCapability,
	FilePermission
} from '../common/files.js';

interface TauriFileStat {
	size: number;
	is_dir: boolean;
	is_file: boolean;
	is_symlink: boolean;
	modified: number;
	created: number;
	readonly: boolean;
}

interface TauriDirEntry {
	name: string;
	path: string;
	is_dir: boolean;
	is_file: boolean;
	is_symlink: boolean;
	size: number;
	modified: number;
}

interface TauriWatchEvent {
	path: string;
	kind: string;
	is_dir: boolean;
}

interface TauriWatchBatch {
	watch_id: number;
	events: TauriWatchEvent[];
}

export class TauriFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	// Trash: native recycle bin (`fs_trash`) is implemented for Windows builds only.
	readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		(isWindows ? FileSystemProviderCapabilities.Trash : FileSystemProviderCapabilities.PathCaseSensitive);

	readonly onDidChangeCapabilities = Event.None;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChangeFile.event;


	static toPath(resource: URI): string {
		if (resource.scheme === 'vscode-file') {
			return decodeURIComponent(resource.path);
		}
		return resource.fsPath;
	}

	private static toError(err: unknown, _resource: URI, fallback: FileSystemProviderErrorCode): Error {
		const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
		return createFileSystemProviderError(msg, TauriFileSystemProvider.classify(msg) ?? fallback);
	}

	/**
	 * Maps Rust I/O errors to provider error codes. The OS message text is localized
	 * (e.g. Chinese Windows), so the stable `(os error N)` suffix and our own markers are used.
	 */
	static classify(message: string): FileSystemProviderErrorCode | undefined {
		if (message.includes('SC_FILE_EXISTS')) {
			return FileSystemProviderErrorCode.FileExists;
		}
		if (message.includes('SC_FILE_NOT_FOUND')) {
			return FileSystemProviderErrorCode.FileNotFound;
		}
		const code = Number(/\(os error (\d+)\)/.exec(message)?.[1]);
		if (!Number.isFinite(code)) {
			return /no such file|not found|ENOENT/i.test(message) ? FileSystemProviderErrorCode.FileNotFound : undefined;
		}
		const byCode: Record<number, FileSystemProviderErrorCode> = isWindows
			? {
					2: FileSystemProviderErrorCode.FileNotFound, // ERROR_FILE_NOT_FOUND
					3: FileSystemProviderErrorCode.FileNotFound, // ERROR_PATH_NOT_FOUND
					5: FileSystemProviderErrorCode.NoPermissions, // ERROR_ACCESS_DENIED
					32: FileSystemProviderErrorCode.Unavailable, // ERROR_SHARING_VIOLATION
					33: FileSystemProviderErrorCode.Unavailable, // ERROR_LOCK_VIOLATION
					80: FileSystemProviderErrorCode.FileExists, // ERROR_FILE_EXISTS
					183: FileSystemProviderErrorCode.FileExists, // ERROR_ALREADY_EXISTS
					267: FileSystemProviderErrorCode.FileNotADirectory // ERROR_DIRECTORY
				}
			: {
					1: FileSystemProviderErrorCode.NoPermissions, // EPERM
					2: FileSystemProviderErrorCode.FileNotFound, // ENOENT
					13: FileSystemProviderErrorCode.NoPermissions, // EACCES
					17: FileSystemProviderErrorCode.FileExists, // EEXIST
					20: FileSystemProviderErrorCode.FileNotADirectory, // ENOTDIR
					21: FileSystemProviderErrorCode.FileIsADirectory // EISDIR
				};
		return byCode[code];
	}

	private static toFileChangeType(kind: string): FileChangeType | undefined {
		switch (kind) {
			case 'created':
				return FileChangeType.ADDED;
			case 'modified':
				return FileChangeType.UPDATED;
			case 'deleted':
				return FileChangeType.DELETED;
			case 'renamed_to':
				return FileChangeType.ADDED;
			case 'renamed_from':
				return FileChangeType.DELETED;
			default:
				return undefined;
		}
	}

	private toFileChanges(batch: TauriWatchBatch, mapEvent: (path: string) => URI | undefined): IFileChange[] {
		const changes: IFileChange[] = [];
		for (const e of batch.events ?? []) {
			const type = TauriFileSystemProvider.toFileChangeType(e.kind);
			const resource = type === undefined ? undefined : mapEvent(e.path);
			if (type !== undefined && resource) {
				changes.push({ type, resource });
			}
		}
		return changes;
	}

	async stat(resource: URI): Promise<IStat> {
		const path = TauriFileSystemProvider.toPath(resource);
		let raw: TauriFileStat;
		try {
			raw = await invoke<TauriFileStat>('stat', { path });
		} catch (err) {
			const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
			if (TauriFileSystemProvider.classify(msg) !== FileSystemProviderErrorCode.FileNotFound) {
				console.debug('[ScCode-FS] stat failed:', path, err);
			}
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.FileNotFound);
		}

		let type: FileType;
		if (raw.is_dir) {
			type = FileType.Directory;
		} else if (raw.is_symlink) {
			type = FileType.SymbolicLink;
		} else {
			type = FileType.File;
		}

		return {
			type,
			mtime: raw.modified * 1000,
			ctime: raw.created * 1000,
			size: raw.size,
			permissions: raw.readonly ? FilePermission.Readonly : undefined
		};
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const path = TauriFileSystemProvider.toPath(resource);
		let entries: TauriDirEntry[];
		try {
			entries = await invoke<TauriDirEntry[]>('read_dir', { path });
		} catch (err) {
			const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
			if (TauriFileSystemProvider.classify(msg) !== FileSystemProviderErrorCode.FileNotFound) {
				console.debug('[ScCode-FS] readdir failed:', path, err);
			}
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.FileNotFound);
		}

		return entries.map(e => {
			let ft: FileType;
			if (e.is_dir) {
				ft = FileType.Directory;
			} else if (e.is_symlink) {
				ft = FileType.SymbolicLink;
			} else {
				ft = FileType.File;
			}
			return [e.name, ft] as [string, FileType];
		});
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const path = TauriFileSystemProvider.toPath(resource);
		try {
			// Raw IPC body: arrives as an ArrayBuffer instead of a JSON number array.
			return new Uint8Array(await invoke<ArrayBuffer>('fs_read_binary', { path }));
		} catch (err) {
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		const path = TauriFileSystemProvider.toPath(resource);
		try {
			await invoke('fs_write_binary', content, {
				headers: {
					'sc-path': encodeURIComponent(path),
					'sc-create': opts.create ? '1' : '0',
					'sc-overwrite': opts.overwrite ? '1' : '0'
				}
			});
		} catch (err) {
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.Unknown);
		}
	}

	async mkdir(resource: URI): Promise<void> {
		const path = TauriFileSystemProvider.toPath(resource);
		try {
			await invoke('mkdir', { path, recursive: true });
		} catch (err) {
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.Unknown);
		}
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		const path = TauriFileSystemProvider.toPath(resource);
		try {
			if (opts.useTrash && isWindows) {
				await invoke('fs_trash', { path });
			} else {
				await invoke('remove', { path, recursive: opts.recursive });
			}
		} catch (err) {
			throw TauriFileSystemProvider.toError(err, resource, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const oldPath = TauriFileSystemProvider.toPath(from);
		const newPath = TauriFileSystemProvider.toPath(to);

		if (!opts.overwrite) {
			let exists: boolean;
			try {
				exists = await invoke<boolean>('exists', { path: newPath });
			} catch {
				exists = false;
			}
			if (exists) {
				throw createFileSystemProviderError(
					`Unable to rename — target '${newPath}' already exists`,
					FileSystemProviderErrorCode.FileExists
				);
			}
		}

		try {
			await invoke('rename', { oldPath, newPath });
		} catch (err) {
			throw TauriFileSystemProvider.toError(err, from, FileSystemProviderErrorCode.Unknown);
		}
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const path = TauriFileSystemProvider.toPath(resource);
		return this.watchMapped(opts, path, eventPath => URI.file(eventPath));
	}

	protected watchMapped(
		opts: IWatchOptions,
		path: string,
		mapEvent: (eventPath: string) => URI | undefined
	): IDisposable {
		let watchId: number | undefined;
		let disposed = false;

		// Batches for this watch arrive on its own channel (only this webview receives them),
		// so no app-wide `watch-batch` listener has to filter every window's events.
		const channel = new Channel<TauriWatchBatch>();
		channel.onmessage = batch => {
			if (disposed) {
				return;
			}
			const changes = this.toFileChanges(batch, mapEvent);
			if (changes.length > 0) {
				this._onDidChangeFile.fire(changes);
			}
		};

		invoke<number>('watch_start', {
			paths: [path],
			options: {
				recursive: opts.recursive,
				debounce_ms: 100,
				ignore_patterns: opts.excludes.length > 0 ? opts.excludes : undefined
			},
			onBatch: channel
		}).then(
			id => {
				if (disposed) {
					invoke('watch_stop', { id }).catch(() => {});
					return;
				}
				watchId = id;
			},
			() => {}
		);

		return toDisposable(() => {
			disposed = true;
			if (watchId !== undefined) {
				invoke('watch_stop', { id: watchId }).catch(() => {});
			}
		});
	}
}
