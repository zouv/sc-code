/*---------------------------------------------------------------------------------------------
 *  ScCode — Tauri-backed provider for the `vscode-userdata:` scheme.
 *  Maps user-data URIs (e.g. `vscode-userdata:/User/settings.json`) to real
 *  paths under the OS app-data directory, so user settings, installed
 *  extensions, themes, keybindings, etc. persist across sessions.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '@tauri-apps/api/core';
import { URI } from '../../../base/common/uri.js';
import { isWindows } from '../../../base/common/platform.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { FileSystemProviderCapabilities, IWatchOptions } from '../common/files.js';
import { TauriFileSystemProvider } from './tauriFileSystemProvider.js';

export class TauriUserDataProvider extends TauriFileSystemProvider {
	// Profile data is deleted for real; only workspace files go to the recycle bin.
	override readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite | (isWindows ? 0 : FileSystemProviderCapabilities.PathCaseSensitive);

	private _rootPath: string | undefined;
	private _rootPromise: Promise<string> | undefined;

	private async resolveRoot(): Promise<string> {
		if (this._rootPath) {
			return this._rootPath;
		}
		if (!this._rootPromise) {
			this._rootPromise = invoke<string>('get_user_data_dir').then(dir => {
				this._rootPath = dir;
				return dir;
			});
		}
		return this._rootPromise;
	}

	private async toFileUri(resource: URI): Promise<URI> {
		const root = await this.resolveRoot();
		const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
		const relative = resource.path.replace(/^\/+/, '').replaceAll('/', sep);
		const joined = relative ? `${root}${sep}${relative}` : root;
		return URI.file(joined);
	}

	private normalizePath(path: string): string {
		return isWindows ? path.replace(/\\/g, '/') : path;
	}

	// ScCode: watch mapped user-data resources and restore scheme URIs
	override watch(resource: URI, opts: IWatchOptions): IDisposable {
		const fileResourcePromise = this.toFileUri(resource);
		let disposed = false;
		let watchDisposable: IDisposable | undefined;
		void fileResourcePromise.then(fileResource => {
			if (disposed) {
				return;
			}
			const root = fileResource.fsPath.replace(/[\\/]+$/, '');
			const normalizedRoot = this.normalizePath(root);
			watchDisposable = this.watchMapped(opts, fileResource.fsPath, eventPath => {
				const normalizedEvent = this.normalizePath(eventPath);
				if (normalizedEvent.toLowerCase() === normalizedRoot.toLowerCase()) {
					return resource;
				}
				const normalizedPrefix = `${normalizedRoot}/`;
				if (!normalizedEvent.toLowerCase().startsWith(normalizedPrefix.toLowerCase())) {
					return undefined;
				}
				const relative = normalizedEvent.slice(normalizedPrefix.length);
				const basePath = resource.path.replace(/\/+$/, '');
				return URI.from({
					scheme: resource.scheme,
					authority: resource.authority,
					path: `${basePath}/${relative}`,
					query: resource.query,
					fragment: resource.fragment
				});
			});
		});
		return {
			dispose: () => {
				disposed = true;
				watchDisposable?.dispose();
			}
		};
	}

	override async stat(resource: URI) {
		return super.stat(await this.toFileUri(resource));
	}

	override async readdir(resource: URI) {
		return super.readdir(await this.toFileUri(resource));
	}

	override async readFile(resource: URI) {
		return super.readFile(await this.toFileUri(resource));
	}

	override async writeFile(
		resource: URI,
		content: Uint8Array,
		opts: Parameters<TauriFileSystemProvider['writeFile']>[2]
	) {
		return super.writeFile(await this.toFileUri(resource), content, opts);
	}

	override async mkdir(resource: URI) {
		return super.mkdir(await this.toFileUri(resource));
	}

	override async delete(resource: URI, opts: Parameters<TauriFileSystemProvider['delete']>[1]) {
		return super.delete(await this.toFileUri(resource), opts);
	}

	override async rename(from: URI, to: URI, opts: Parameters<TauriFileSystemProvider['rename']>[2]) {
		const [fromFile, toFile] = await Promise.all([this.toFileUri(from), this.toFileUri(to)]);
		return super.rename(fromFile, toFile, opts);
	}
}
