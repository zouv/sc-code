/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { dirname, isEqualOrParent } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IExtHostCommands } from './extHostCommands.js';
import { ExtHostFileSystemEventService } from './extHostFileSystemEventService.js';
import * as extHostTypes from './extHostTypes.js';
import { IExtHostWorkspace } from './extHostWorkspace.js';

export const enum ForcePushMode {
	Force = 0,
	ForceWithLease = 1,
	ForceWithLeaseIfIncludes = 2,
}

export const enum RefType {
	Head = 0,
	RemoteHead = 1,
	Tag = 2,
}

export const enum Status {
	INDEX_MODIFIED = 0,
	INDEX_ADDED = 1,
	INDEX_DELETED = 2,
	INDEX_RENAMED = 3,
	INDEX_COPIED = 4,

	MODIFIED = 5,
	DELETED = 6,
	UNTRACKED = 7,
	IGNORED = 8,
	INTENT_TO_ADD = 9,
	INTENT_TO_RENAME = 10,
	TYPE_CHANGED = 11,

	ADDED_BY_US = 12,
	ADDED_BY_THEM = 13,
	DELETED_BY_US = 14,
	DELETED_BY_THEM = 15,
	BOTH_ADDED = 16,
	BOTH_DELETED = 17,
	BOTH_MODIFIED = 18,
}

export const enum GitErrorCodes {
	BadConfigFile = 'BadConfigFile',
	AuthenticationFailed = 'AuthenticationFailed',
	NoUserNameConfigured = 'NoUserNameConfigured',
	NoUserEmailConfigured = 'NoUserEmailConfigured',
	NoRemoteRepositorySpecified = 'NoRemoteRepositorySpecified',
	NotAGitRepository = 'NotAGitRepository',
	NotAtRepositoryRoot = 'NotAtRepositoryRoot',
	Conflict = 'Conflict',
	StashConflict = 'StashConflict',
	UnmergedChanges = 'UnmergedChanges',
	PushRejected = 'PushRejected',
	ForcePushWithLeaseRejected = 'ForcePushWithLeaseRejected',
	ForcePushWithLeaseIfIncludesRejected = 'ForcePushWithLeaseIfIncludesRejected',
	RemoteConnectionError = 'RemoteConnectionError',
	DirtyWorkTree = 'DirtyWorkTree',
	CantOpenResource = 'CantOpenResource',
	GitNotFound = 'GitNotFound',
	CantCreatePipe = 'CantCreatePipe',
	PermissionDenied = 'PermissionDenied',
	CantAccessRemote = 'CantAccessRemote',
	RepositoryNotFound = 'RepositoryNotFound',
	RepositoryIsLocked = 'RepositoryIsLocked',
	BranchNotFullyMerged = 'BranchNotFullyMerged',
	NoRemoteReference = 'NoRemoteReference',
	InvalidBranchName = 'InvalidBranchName',
	BranchAlreadyExists = 'BranchAlreadyExists',
	NoLocalChanges = 'NoLocalChanges',
	NoStashFound = 'NoStashFound',
	LocalChangesOverwritten = 'LocalChangesOverwritten',
	NoUpstreamBranch = 'NoUpstreamBranch',
	IsInSubmodule = 'IsInSubmodule',
	WrongCase = 'WrongCase',
	CantLockRef = 'CantLockRef',
	CantRebaseMultipleBranches = 'CantRebaseMultipleBranches',
	PatchDoesNotApply = 'PatchDoesNotApply',
	NoPathFound = 'NoPathFound',
	UnknownPath = 'UnknownPath',
	EmptyCommitMessage = 'EmptyCommitMessage',
	BranchFastForwardRejected = 'BranchFastForwardRejected',
	BranchNotYetBorn = 'BranchNotYetBorn',
	TagConflict = 'TagConflict',
	CherryPickEmpty = 'CherryPickEmpty',
	WorktreeContainsChanges = 'WorktreeContainsChanges',
	WorktreeAlreadyExists = 'WorktreeAlreadyExists',
	WorktreeBranchAlreadyUsed = 'WorktreeBranchAlreadyUsed',
}

export interface GitChange {
	readonly uri: vscode.Uri;
	readonly originalUri: vscode.Uri;
	readonly renameUri: vscode.Uri | undefined;
	readonly status: Status;
}

export interface GitRef {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly remote?: string;
	readonly commitDetails?: GitCommit;
}

export interface GitUpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface GitBranch extends GitRef {
	readonly upstream?: GitUpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface GitCommitShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface GitCommit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly commitDate?: Date;
	readonly shortStat?: GitCommitShortStat;
}

export interface GitRemote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export interface GitSubmodule {
	readonly name: string;
	readonly path: string;
	readonly url: string;
}

export interface GitWorktree {
	readonly name: string;
	readonly path: string;
	readonly ref: string;
	readonly detached: boolean;
	readonly main: boolean;
}

export interface GitRepositoryState {
	readonly HEAD: GitBranch | undefined;
	readonly refs: GitRef[];
	readonly remotes: GitRemote[];
	readonly submodules: GitSubmodule[];
	readonly worktrees: GitWorktree[];
	readonly rebaseCommit: GitCommit | undefined;
	readonly mergeChanges: GitChange[];
	readonly indexChanges: GitChange[];
	readonly workingTreeChanges: GitChange[];
	readonly untrackedChanges: GitChange[];
	readonly onDidChange: vscode.Event<void>;
}

export interface GitRepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: vscode.Event<void>;
}

export interface GitInputBox {
	value: string;
}

export interface GitLogOptions {
	readonly maxEntries?: number;
	readonly path?: string;
	readonly follow?: boolean;
	readonly all?: boolean;
	readonly sortByAuthorDate?: boolean;
	readonly shortStats?: boolean;
	readonly author?: string;
	readonly grep?: string;
	readonly refNames?: string[];
}

export interface GitCommitOptions {
	all?: boolean | 'tracked';
	amend?: boolean;
	signoff?: boolean;
	signCommit?: boolean;
	empty?: boolean;
	noVerify?: boolean;
	requireUserConfig?: boolean;
	useEditor?: boolean;
	verbose?: boolean;
	postCommitCommand?: string | null;
}

export interface GitFetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}

export interface GitBranchQuery {
	readonly remote?: boolean;
	readonly pattern?: string;
	readonly count?: number;
	readonly contains?: string;
	readonly sort?: 'alphabetically' | 'committerdate';
}

export interface GitRefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate' | 'creatordate';
	readonly includeCommitDetails?: boolean;
}

type ExecFileFn = (
	file: string,
	args: readonly string[],
	options: { cwd?: string; encoding?: string; maxBuffer?: number; windowsHide?: boolean },
	callback: (error: (Error & { stdout?: string; stderr?: string; code?: number | string }) | null, stdout: string, stderr: string) => void
) => void;

interface IGitExecResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

interface INodePathLike {
	isAbsolute(p: string): boolean;
	relative(from: string, to: string): string;
	resolve(...segments: string[]): string;
	join(...segments: string[]): string;
}

interface INodeFsLike {
	writeFileSync(file: string, data: string, encoding: string): void;
	unlinkSync(file: string): void;
	statSync(file: string): { isFile(): boolean };
}

function getNodeRequire(): ((id: string) => unknown) | undefined {
	const g = globalThis as { require?: (id: string) => unknown };
	return typeof g.require === 'function' ? g.require : undefined;
}

function getNodeExecFile(): ExecFileFn | undefined {
	try {
		const req = getNodeRequire();
		if (!req) {
			return undefined;
		}
		const cp = req('node:child_process') as { execFile?: ExecFileFn };
		return cp.execFile;
	} catch {
		return undefined;
	}
}

function getNodePathModule(): INodePathLike | undefined {
	try {
		const req = getNodeRequire();
		return req ? (req('node:path') as INodePathLike) : undefined;
	} catch {
		return undefined;
	}
}

function getNodeFsModule(): INodeFsLike | undefined {
	try {
		const req = getNodeRequire();
		return req ? (req('node:fs') as INodeFsLike) : undefined;
	} catch {
		return undefined;
	}
}

async function execGit(args: string[], cwd?: string): Promise<IGitExecResult> {
	const execFile = getNodeExecFile();
	if (!execFile) {
		return { exitCode: 1, stdout: '', stderr: 'Git execution is only available in the Node extension host' };
	}
	return new Promise<IGitExecResult>(resolve => {
		execFile(
			'git',
			args,
			{
				cwd,
				encoding: 'utf8',
				maxBuffer: 32 * 1024 * 1024,
				windowsHide: true,
			},
			(err, stdout, stderr) => {
				if (err) {
					const exitCode = typeof err.code === 'number' ? err.code : 1;
					resolve({
						exitCode,
						stdout: stdout ?? err.stdout ?? '',
						stderr: stderr ?? err.stderr ?? err.message ?? '',
					});
					return;
				}
				resolve({
					exitCode: 0,
					stdout: stdout ?? '',
					stderr: stderr ?? '',
				});
			}
		);
	});
}

async function execGitOrThrow(args: string[], cwd?: string): Promise<string> {
	const result = await execGit(args, cwd);
	if (result.exitCode !== 0) {
		const error = new Error(result.stderr.trim() || `git ${args[0] ?? ''} failed with exit code ${result.exitCode}`) as Error & {
			stdout?: string;
			stderr?: string;
			exitCode?: number;
			gitErrorCode?: string;
		};
		error.stdout = result.stdout;
		error.stderr = result.stderr;
		error.exitCode = result.exitCode;
		throw error;
	}
	return result.stdout;
}

function toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
	return URI.from({
		scheme: 'git',
		path: uri.path,
		query: JSON.stringify({
			path: uri.fsPath,
			ref,
		}),
	});
}

function parsePorcelainStatusPair(xy: string): { indexStatus?: Status; workingTreeStatus?: Status; mergeStatus?: Status; untracked?: boolean; ignored?: boolean } {
	const x = xy[0] ?? ' ';
	const y = xy[1] ?? ' ';

	if (xy === '??') {
		return { untracked: true };
	}
	if (xy === '!!') {
		return { ignored: true };
	}
	if (xy === 'DD') {
		return { mergeStatus: Status.BOTH_DELETED };
	}
	if (xy === 'AU') {
		return { mergeStatus: Status.ADDED_BY_US };
	}
	if (xy === 'UD') {
		return { mergeStatus: Status.DELETED_BY_THEM };
	}
	if (xy === 'UA') {
		return { mergeStatus: Status.ADDED_BY_THEM };
	}
	if (xy === 'DU') {
		return { mergeStatus: Status.DELETED_BY_US };
	}
	if (xy === 'AA') {
		return { mergeStatus: Status.BOTH_ADDED };
	}
	if (xy === 'UU') {
		return { mergeStatus: Status.BOTH_MODIFIED };
	}

	let indexStatus: Status | undefined;
	switch (x) {
		case 'M': indexStatus = Status.INDEX_MODIFIED; break;
		case 'T': indexStatus = Status.TYPE_CHANGED; break;
		case 'A': indexStatus = Status.INDEX_ADDED; break;
		case 'D': indexStatus = Status.INDEX_DELETED; break;
		case 'R': indexStatus = Status.INDEX_RENAMED; break;
		case 'C': indexStatus = Status.INDEX_COPIED; break;
	}

	let workingTreeStatus: Status | undefined;
	switch (y) {
		case 'M': workingTreeStatus = Status.MODIFIED; break;
		case 'T': workingTreeStatus = Status.TYPE_CHANGED; break;
		case 'D': workingTreeStatus = Status.DELETED; break;
		case 'A': workingTreeStatus = Status.INTENT_TO_ADD; break;
	}

	return { indexStatus, workingTreeStatus };
}

class ScCodeGitRepository extends Disposable {
	private readonly _onDidChangeState = this._register(new Emitter<void>());
	private readonly _onDidChangeUiState = this._register(new Emitter<void>());
	private readonly _onDidCommit = this._register(new Emitter<void>());
	private readonly _onDidCheckout = this._register(new Emitter<void>());

	private _HEAD: GitBranch | undefined;
	private _refs: GitRef[] = [];
	private _remotes: GitRemote[] = [];
	private _submodules: GitSubmodule[] = [];
	private _worktrees: GitWorktree[] = [];
	private _rebaseCommit: GitCommit | undefined;
	private _mergeChanges: GitChange[] = [];
	private _indexChanges: GitChange[] = [];
	private _workingTreeChanges: GitChange[] = [];
	private _untrackedChanges: GitChange[] = [];
	private _refreshPromise: Promise<void> | undefined;

	readonly inputBox: GitInputBox = { value: '' };

	readonly state: GitRepositoryState;
	readonly ui: GitRepositoryUIState;

	readonly onDidCommit: vscode.Event<void> = this._onDidCommit.event;
	readonly onDidCheckout: vscode.Event<void> = this._onDidCheckout.event;

	constructor(
		readonly rootUri: URI,
		private readonly _logService: ILogService,
	) {
		super();
		const self = this;
		this.state = {
			get HEAD() { return self._HEAD; },
			get refs() { return self._refs; },
			get remotes() { return self._remotes; },
			get submodules() { return self._submodules; },
			get worktrees() { return self._worktrees; },
			get rebaseCommit() { return self._rebaseCommit; },
			get mergeChanges() { return self._mergeChanges; },
			get indexChanges() { return self._indexChanges; },
			get workingTreeChanges() { return self._workingTreeChanges; },
			get untrackedChanges() { return self._untrackedChanges; },
			onDidChange: this._onDidChangeState.event,
		};
		this.ui = {
			selected: true,
			onDidChange: this._onDidChangeUiState.event,
		};
	}

	private get _cwd(): string {
		return this.rootUri.fsPath;
	}

	private _toRelativePath(pathOrUri: string | vscode.Uri): string {
		const fsPath = typeof pathOrUri === 'string'
			? (pathOrUri.startsWith('file://') ? URI.parse(pathOrUri).fsPath : pathOrUri)
			: pathOrUri.fsPath;
		const pathMod = getNodePathModule();
		if (!pathMod) {
			return fsPath;
		}
		if (!pathMod.isAbsolute(fsPath)) {
			return fsPath.replace(/\\/g, '/');
		}
		const rel = pathMod.relative(this._cwd, fsPath);
		return (rel || '.').replace(/\\/g, '/');
	}

	private _resolveRepoUri(relPath: string): URI {
		const pathMod = getNodePathModule();
		if (pathMod) {
			return URI.file(pathMod.resolve(this._cwd, relPath));
		}
		return URI.joinPath(this.rootUri, relPath);
	}

	async status(): Promise<void> {
		if (this._refreshPromise) {
			return this._refreshPromise;
		}
		this._refreshPromise = this._doRefreshState().finally(() => {
			this._refreshPromise = undefined;
		});
		return this._refreshPromise;
	}

	private async _doRefreshState(): Promise<void> {
		try {
			const [statusRes, refsRes, remotesRes] = await Promise.all([
				execGit(['status', '--porcelain=v1', '-b', '-z', '-uall'], this._cwd),
				execGit(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream:short)'], this._cwd),
				execGit(['remote', '-v'], this._cwd),
			]);

			if (statusRes.exitCode === 0) {
				this._parseStatusOutput(statusRes.stdout);
			}
			if (refsRes.exitCode === 0) {
				this._parseRefsOutput(refsRes.stdout);
			}
			if (remotesRes.exitCode === 0) {
				this._parseRemotesOutput(remotesRes.stdout);
			}

			this._onDidChangeState.fire();
		} catch (err) {
			this._logService.debug('[ScCodeGitExtensionApi] repository refresh failed', err);
		}
	}

	private _parseStatusOutput(raw: string): void {
		const entries = raw.split('\0');
		const mergeChanges: GitChange[] = [];
		const indexChanges: GitChange[] = [];
		const workingTreeChanges: GitChange[] = [];
		const untrackedChanges: GitChange[] = [];

		let headName: string | undefined;
		let upstreamRemote: string | undefined;
		let upstreamName: string | undefined;
		let ahead = 0;
		let behind = 0;

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (!entry) {
				continue;
			}
			if (entry.startsWith('## ')) {
				const header = entry.slice(3).trim();
				const bracketIdx = header.indexOf(' [');
				const branchPart = bracketIdx >= 0 ? header.slice(0, bracketIdx) : header;
				const trackPart = bracketIdx >= 0 ? header.slice(bracketIdx + 2, -1) : '';

				if (branchPart.startsWith('No commits yet on ') || branchPart.startsWith('Initial commit on ')) {
					headName = branchPart.replace(/^(No commits yet on |Initial commit on )/, '').trim();
				} else if (!branchPart.startsWith('HEAD (')) {
					const dotsIdx = branchPart.indexOf('...');
					if (dotsIdx >= 0) {
						headName = branchPart.slice(0, dotsIdx);
						const up = branchPart.slice(dotsIdx + 3);
						const slashIdx = up.indexOf('/');
						if (slashIdx > 0) {
							upstreamRemote = up.slice(0, slashIdx);
							upstreamName = up.slice(slashIdx + 1);
						}
					} else {
						headName = branchPart;
					}
				}

				if (trackPart) {
					const aheadMatch = /ahead (\d+)/.exec(trackPart);
					const behindMatch = /behind (\d+)/.exec(trackPart);
					if (aheadMatch) {
						ahead = Number(aheadMatch[1]);
					}
					if (behindMatch) {
						behind = Number(behindMatch[1]);
					}
				}
				continue;
			}

			if (entry.length < 4) {
				continue;
			}
			const xy = entry.slice(0, 2);
			const filePath = entry.slice(3);
			let origPath = filePath;
			if (xy[0] === 'R' || xy[0] === 'C') {
				const nextEntry = entries[i + 1];
				if (nextEntry) {
					origPath = nextEntry;
					i++;
				}
			}

			const uri = this._resolveRepoUri(filePath);
			const originalUri = this._resolveRepoUri(origPath);
			const renameUri = origPath !== filePath ? uri : undefined;
			const parsed = parsePorcelainStatusPair(xy);

			if (parsed.untracked) {
				const change: GitChange = { uri, originalUri, renameUri: undefined, status: Status.UNTRACKED };
				untrackedChanges.push(change);
				workingTreeChanges.push(change);
				continue;
			}
			if (parsed.mergeStatus !== undefined) {
				mergeChanges.push({ uri, originalUri, renameUri, status: parsed.mergeStatus });
				continue;
			}
			if (parsed.indexStatus !== undefined) {
				indexChanges.push({ uri, originalUri, renameUri, status: parsed.indexStatus });
			}
			if (parsed.workingTreeStatus !== undefined) {
				workingTreeChanges.push({ uri, originalUri, renameUri, status: parsed.workingTreeStatus });
			}
		}

		this._mergeChanges = mergeChanges;
		this._indexChanges = indexChanges;
		this._workingTreeChanges = workingTreeChanges;
		this._untrackedChanges = untrackedChanges;
		this._HEAD = {
			type: RefType.Head,
			name: headName,
			ahead,
			behind,
			upstream: upstreamRemote && upstreamName ? { remote: upstreamRemote, name: upstreamName } : undefined,
		};
	}

	private _parseRefsOutput(raw: string): void {
		const refs: GitRef[] = [];
		let headCommit: string | undefined;
		for (const line of raw.split(/\r?\n/)) {
			if (!line) {
				continue;
			}
			const [refname, commit] = line.split('\0');
			if (!refname || !commit) {
				continue;
			}
			if (refname.startsWith('refs/heads/')) {
				const name = refname.slice('refs/heads/'.length);
				refs.push({ type: RefType.Head, name, commit });
				if (this._HEAD && this._HEAD.name === name) {
					headCommit = commit;
				}
			} else if (refname.startsWith('refs/remotes/')) {
				const rest = refname.slice('refs/remotes/'.length);
				const slashIdx = rest.indexOf('/');
				const remote = slashIdx > 0 ? rest.slice(0, slashIdx) : rest;
				refs.push({ type: RefType.RemoteHead, name: rest, remote, commit });
			} else if (refname.startsWith('refs/tags/')) {
				const name = refname.slice('refs/tags/'.length);
				refs.push({ type: RefType.Tag, name, commit });
			}
		}
		this._refs = refs;
		if (this._HEAD && headCommit) {
			this._HEAD = { ...this._HEAD, commit: headCommit };
		}
	}

	private _parseRemotesOutput(raw: string): void {
		const byName = new Map<string, { fetchUrl?: string; pushUrl?: string }>();
		for (const line of raw.split(/\r?\n/)) {
			const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
			if (!match) {
				continue;
			}
			const [, name, url, kind] = match;
			const entry = byName.get(name) ?? {};
			if (kind === 'fetch') {
				entry.fetchUrl = url;
			} else {
				entry.pushUrl = url;
			}
			byName.set(name, entry);
		}
		this._remotes = Array.from(byName.entries()).map(([name, urls]) => ({
			name,
			fetchUrl: urls.fetchUrl,
			pushUrl: urls.pushUrl,
			isReadOnly: false,
		}));
	}

	async getConfigs(): Promise<{ key: string; value: string }[]> {
		return this._getConfigs(['--local']);
	}

	async getConfig(key: string): Promise<string> {
		const res = await execGit(['config', '--local', '--get', key], this._cwd);
		return res.exitCode === 0 ? res.stdout.trim() : '';
	}

	async setConfig(key: string, value: string): Promise<string> {
		await execGitOrThrow(['config', '--local', key, value], this._cwd);
		return value;
	}

	async unsetConfig(key: string): Promise<string> {
		const prev = await this.getConfig(key);
		await execGit(['config', '--local', '--unset', key], this._cwd);
		return prev;
	}

	async getGlobalConfig(key: string): Promise<string> {
		const res = await execGit(['config', '--global', '--get', key], this._cwd);
		return res.exitCode === 0 ? res.stdout.trim() : '';
	}

	private async _getConfigs(scopeArgs: string[]): Promise<{ key: string; value: string }[]> {
		const res = await execGit(['config', ...scopeArgs, '--list', '-z'], this._cwd);
		if (res.exitCode !== 0) {
			return [];
		}
		const entries: { key: string; value: string }[] = [];
		for (const item of res.stdout.split('\0')) {
			if (!item) {
				continue;
			}
			const nlIdx = item.indexOf('\n');
			if (nlIdx > 0) {
				entries.push({ key: item.slice(0, nlIdx), value: item.slice(nlIdx + 1) });
			}
		}
		return entries;
	}

	async getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number }> {
		const relPath = this._toRelativePath(path);
		const spec = treeish ? `${treeish}:${relPath}` : `:${relPath}`;
		const stdout = await execGitOrThrow(['cat-file', '-p', spec], this._cwd);
		return {
			mode: '100644',
			object: spec,
			size: new TextEncoder().encode(stdout).byteLength,
		};
	}

	async detectObjectType(object: string): Promise<{ mimetype: string; encoding?: string }> {
		const res = await execGit(['cat-file', '-t', object], this._cwd);
		return { mimetype: res.exitCode === 0 ? 'text/plain' : 'application/octet-stream', encoding: 'utf8' };
	}

	async buffer(ref: string, filePath: string): Promise<Uint8Array> {
		const content = await this.show(ref, filePath);
		return new TextEncoder().encode(content);
	}

	async show(ref: string, filePath: string): Promise<string> {
		const relPath = this._toRelativePath(filePath);
		const spec = !ref || ref === '~' ? `:${relPath}` : `${ref}:${relPath}`;
		return execGitOrThrow(['show', spec], this._cwd);
	}

	async getCommit(ref: string): Promise<GitCommit> {
		const stdout = await execGitOrThrow(
			['log', '-n', '1', '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%B', ref],
			this._cwd
		);
		const [hash = '', parentsRaw = '', authorName = '', authorEmail = '', authorTs = '', commitTs = '', message = ''] = stdout.split('\0');
		return {
			hash: hash.trim(),
			parents: parentsRaw.trim() ? parentsRaw.trim().split(' ') : [],
			authorName,
			authorEmail,
			authorDate: authorTs ? new Date(Number(authorTs) * 1000) : undefined,
			commitDate: commitTs ? new Date(Number(commitTs) * 1000) : undefined,
			message: message.trim(),
		};
	}

	async add(paths: string[]): Promise<void> {
		const relPaths = paths.map(p => this._toRelativePath(p));
		await execGitOrThrow(['add', '--', ...(relPaths.length ? relPaths : ['.'])], this._cwd);
		await this.status();
	}

	async revert(paths: string[]): Promise<void> {
		const relPaths = paths.map(p => this._toRelativePath(p));
		if (relPaths.length === 0) {
			return;
		}
		await execGitOrThrow(['checkout', '--', ...relPaths], this._cwd);
		await this.status();
	}

	async clean(paths: string[]): Promise<void> {
		const relPaths = paths.map(p => this._toRelativePath(p));
		if (relPaths.length === 0) {
			return;
		}
		await execGitOrThrow(['clean', '-f', '-q', '--', ...relPaths], this._cwd);
		await this.status();
	}

	async apply(patch: string, reverse?: boolean): Promise<void> {
		const fsMod = getNodeFsModule();
		const pathMod = getNodePathModule();
		if (!fsMod || !pathMod) {
			return;
		}
		const tmpFile = pathMod.join(this._cwd, `.git`, `sccode-patch-${Date.now()}.patch`);
		try {
			fsMod.writeFileSync(tmpFile, patch, 'utf8');
			const args = ['apply'];
			if (reverse) {
				args.push('--reverse');
			}
			args.push(tmpFile);
			await execGitOrThrow(args, this._cwd);
			await this.status();
		} finally {
			try { fsMod.unlinkSync(tmpFile); } catch { /* ignore */ }
		}
	}

	async diff(cached?: boolean): Promise<string> {
		const args = ['diff'];
		if (cached) {
			args.push('--cached');
		}
		const res = await execGit(args, this._cwd);
		return res.stdout;
	}

	async diffWithHEAD(): Promise<GitChange[]>;
	async diffWithHEAD(path: string): Promise<string>;
	async diffWithHEAD(path?: string): Promise<string | GitChange[]> {
		if (typeof path === 'string') {
			const relPath = this._toRelativePath(path);
			const res = await execGit(['diff', 'HEAD', '--', relPath], this._cwd);
			return res.stdout;
		}
		await this.status();
		return [...this._indexChanges, ...this._workingTreeChanges];
	}

	async diffWith(ref: string): Promise<GitChange[]>;
	async diffWith(ref: string, path: string): Promise<string>;
	async diffWith(ref: string, path?: string): Promise<string | GitChange[]> {
		if (typeof path === 'string') {
			const relPath = this._toRelativePath(path);
			const res = await execGit(['diff', ref, '--', relPath], this._cwd);
			return res.stdout;
		}
		return this._diffNameStatus([ref]);
	}

	async diffIndexWithHEAD(): Promise<GitChange[]>;
	async diffIndexWithHEAD(path: string): Promise<string>;
	async diffIndexWithHEAD(path?: string): Promise<string | GitChange[]> {
		if (typeof path === 'string') {
			const relPath = this._toRelativePath(path);
			const res = await execGit(['diff', '--cached', 'HEAD', '--', relPath], this._cwd);
			return res.stdout;
		}
		await this.status();
		return [...this._indexChanges];
	}

	async diffIndexWith(ref: string): Promise<GitChange[]>;
	async diffIndexWith(ref: string, path: string): Promise<string>;
	async diffIndexWith(ref: string, path?: string): Promise<string | GitChange[]> {
		if (typeof path === 'string') {
			const relPath = this._toRelativePath(path);
			const res = await execGit(['diff', '--cached', ref, '--', relPath], this._cwd);
			return res.stdout;
		}
		return this._diffNameStatus(['--cached', ref]);
	}

	async diffBlobs(object1: string, object2: string): Promise<string> {
		const res = await execGit(['diff', object1, object2], this._cwd);
		return res.stdout;
	}

	async diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
	async diffBetween(ref1: string, ref2: string, path: string): Promise<string>;
	async diffBetween(ref1: string, ref2: string, path?: string): Promise<string | GitChange[]> {
		if (typeof path === 'string') {
			const relPath = this._toRelativePath(path);
			const res = await execGit(['diff', `${ref1}...${ref2}`, '--', relPath], this._cwd);
			return res.stdout;
		}
		return this._diffNameStatus([`${ref1}...${ref2}`]);
	}

	private async _diffNameStatus(diffArgs: string[]): Promise<GitChange[]> {
		const res = await execGit(['diff', '--name-status', '-z', ...diffArgs], this._cwd);
		if (res.exitCode !== 0) {
			return [];
		}
		const tokens = res.stdout.split('\0').filter(Boolean);
		const changes: GitChange[] = [];
		for (let i = 0; i < tokens.length; i += 2) {
			const code = tokens[i] ?? 'M';
			const firstPath = tokens[i + 1];
			if (!firstPath) {
				break;
			}
			let targetPath = firstPath;
			if (code.startsWith('R') || code.startsWith('C')) {
				targetPath = tokens[i + 2] ?? firstPath;
				i++;
			}
			const uri = this._resolveRepoUri(targetPath);
			const originalUri = this._resolveRepoUri(firstPath);
			let status = Status.MODIFIED;
			if (code.startsWith('A')) {
				status = Status.INDEX_ADDED;
			} else if (code.startsWith('D')) {
				status = Status.DELETED;
			} else if (code.startsWith('R')) {
				status = Status.INDEX_RENAMED;
			} else if (code.startsWith('C')) {
				status = Status.INDEX_COPIED;
			}
			changes.push({
				uri,
				originalUri,
				renameUri: targetPath !== firstPath ? uri : undefined,
				status,
			});
		}
		return changes;
	}

	async hashObject(data: string): Promise<string> {
		const fsMod = getNodeFsModule();
		const pathMod = getNodePathModule();
		if (!fsMod || !pathMod) {
			return '';
		}
		const tmpFile = pathMod.join(this._cwd, `.git`, `sccode-hash-${Date.now()}.tmp`);
		try {
			fsMod.writeFileSync(tmpFile, data, 'utf8');
			const out = await execGitOrThrow(['hash-object', '-w', tmpFile], this._cwd);
			return out.trim();
		} finally {
			try { fsMod.unlinkSync(tmpFile); } catch { /* ignore */ }
		}
	}

	async createBranch(name: string, checkout: boolean, ref?: string): Promise<void> {
		if (checkout) {
			const args = ['checkout', '-b', name];
			if (ref) {
				args.push(ref);
			}
			await execGitOrThrow(args, this._cwd);
			this._onDidCheckout.fire();
		} else {
			const args = ['branch', name];
			if (ref) {
				args.push(ref);
			}
			await execGitOrThrow(args, this._cwd);
		}
		await this.status();
	}

	async deleteBranch(name: string, force?: boolean): Promise<void> {
		await execGitOrThrow(['branch', force ? '-D' : '-d', name], this._cwd);
		await this.status();
	}

	async getBranch(name: string): Promise<GitBranch> {
		await this.status();
		const found = this._refs.find(r => r.name === name && (r.type === RefType.Head || r.type === RefType.RemoteHead));
		if (found) {
			return found;
		}
		const res = await execGitOrThrow(['rev-parse', '--verify', name], this._cwd);
		return {
			type: RefType.Head,
			name,
			commit: res.trim(),
		};
	}

	async getBranches(query: GitBranchQuery): Promise<GitRef[]> {
		await this.status();
		let results = this._refs.filter(r => query.remote ? (r.type === RefType.Head || r.type === RefType.RemoteHead) : r.type === RefType.Head);
		if (query.pattern) {
			const prefix = query.pattern.replace(/\*.*$/, '');
			results = results.filter(r => r.name?.startsWith(prefix));
		}
		if (typeof query.count === 'number' && query.count > 0) {
			results = results.slice(0, query.count);
		}
		return results;
	}

	async getRefs(query: GitRefQuery): Promise<GitRef[]> {
		await this.status();
		let results = [...this._refs];
		if (query.pattern) {
			const patterns = Array.isArray(query.pattern) ? query.pattern : [query.pattern];
			const prefixes = patterns.map(p => p.replace(/^refs\/(heads|remotes|tags)\//, '').replace(/\*.*$/, ''));
			results = results.filter(r => prefixes.some(pref => (r.name ?? '').startsWith(pref)));
		}
		if (typeof query.count === 'number' && query.count > 0) {
			results = results.slice(0, query.count);
		}
		return results;
	}

	async setBranchUpstream(name: string, upstream: string): Promise<void> {
		await execGitOrThrow(['branch', '--set-upstream-to', upstream, name], this._cwd);
		await this.status();
	}

	async getMergeBase(ref1: string, ref2: string): Promise<string | undefined> {
		const res = await execGit(['merge-base', ref1, ref2], this._cwd);
		return res.exitCode === 0 ? res.stdout.trim() || undefined : undefined;
	}

	async tag(name: string, upstream: string): Promise<void> {
		const args = ['tag', name];
		if (upstream) {
			args.push(upstream);
		}
		await execGitOrThrow(args, this._cwd);
		await this.status();
	}

	async deleteTag(name: string): Promise<void> {
		await execGitOrThrow(['tag', '-d', name], this._cwd);
		await this.status();
	}

	async checkIgnore(paths: string[]): Promise<Set<string>> {
		if (paths.length === 0) {
			return new Set<string>();
		}
		const relPaths = paths.map(p => this._toRelativePath(p));
		const res = await execGit(['check-ignore', '-z', '--', ...relPaths], this._cwd);
		if (res.exitCode !== 0 && !res.stdout) {
			return new Set<string>();
		}
		const ignored = new Set<string>();
		for (const item of res.stdout.split('\0')) {
			if (item) {
				ignored.add(this._resolveRepoUri(item).fsPath);
			}
		}
		return ignored;
	}

	async checkout(treeish: string): Promise<void> {
		await execGitOrThrow(['checkout', treeish], this._cwd);
		this._onDidCheckout.fire();
		await this.status();
	}

	async addRemote(name: string, url: string): Promise<void> {
		await execGitOrThrow(['remote', 'add', name, url], this._cwd);
		await this.status();
	}

	async removeRemote(name: string): Promise<void> {
		await execGitOrThrow(['remote', 'remove', name], this._cwd);
		await this.status();
	}

	async renameRemote(name: string, newName: string): Promise<void> {
		await execGitOrThrow(['remote', 'rename', name, newName], this._cwd);
		await this.status();
	}

	async fetch(options?: GitFetchOptions | string, ref?: string, depth?: number): Promise<void> {
		const args = ['fetch'];
		if (typeof options === 'string') {
			args.push(options);
			if (ref) {
				args.push(ref);
			}
			if (typeof depth === 'number') {
				args.push(`--depth=${depth}`);
			}
		} else if (options) {
			if (options.all) {
				args.push('--all');
			}
			if (options.prune) {
				args.push('--prune');
			}
			if (typeof options.depth === 'number') {
				args.push(`--depth=${options.depth}`);
			}
			if (options.remote) {
				args.push(options.remote);
				if (options.ref) {
					args.push(options.ref);
				}
			}
		}
		await execGitOrThrow(args, this._cwd);
		await this.status();
	}

	async pull(unshallow?: boolean): Promise<void> {
		const args = ['pull'];
		if (unshallow) {
			args.push('--unshallow');
		}
		await execGitOrThrow(args, this._cwd);
		await this.status();
	}

	async push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void> {
		const args = ['push'];
		if (setUpstream) {
			args.push('--set-upstream');
		}
		if (force === ForcePushMode.Force) {
			args.push('--force');
		} else if (force === ForcePushMode.ForceWithLease) {
			args.push('--force-with-lease');
		} else if (force === ForcePushMode.ForceWithLeaseIfIncludes) {
			args.push('--force-with-lease', '--force-if-includes');
		}
		if (remoteName) {
			args.push(remoteName);
			if (branchName) {
				args.push(branchName);
			}
		}
		await execGitOrThrow(args, this._cwd);
		await this.status();
	}

	async blame(path: string): Promise<string> {
		const relPath = this._toRelativePath(path);
		return execGitOrThrow(['blame', '--', relPath], this._cwd);
	}

	async log(options?: GitLogOptions): Promise<GitCommit[]> {
		const maxEntries = options?.maxEntries ?? 32;
		const args = [
			'log',
			`-n`,
			String(maxEntries),
			'--format=%x1e%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%B%x00',
		];
		if (options?.all) {
			args.push('--all');
		}
		if (options?.follow && options?.path) {
			args.push('--follow');
		}
		if (options?.sortByAuthorDate) {
			args.push('--author-date-order');
		}
		if (options?.author) {
			args.push(`--author=${options.author}`);
		}
		if (options?.grep) {
			args.push(`--grep=${options.grep}`);
		}
		if (options?.refNames?.length) {
			args.push(...options.refNames);
		}
		if (options?.path) {
			args.push('--', this._toRelativePath(options.path));
		}

		const res = await execGit(args, this._cwd);
		if (res.exitCode !== 0) {
			return [];
		}
		const commits: GitCommit[] = [];
		for (const record of res.stdout.split('\x1e')) {
			const trimmed = record.trim();
			if (!trimmed) {
				continue;
			}
			const [hash = '', parentsRaw = '', authorName = '', authorEmail = '', authorTs = '', commitTs = '', message = ''] = trimmed.split('\0');
			if (!hash) {
				continue;
			}
			commits.push({
				hash: hash.trim(),
				parents: parentsRaw.trim() ? parentsRaw.trim().split(' ') : [],
				authorName,
				authorEmail,
				authorDate: authorTs ? new Date(Number(authorTs) * 1000) : undefined,
				commitDate: commitTs ? new Date(Number(commitTs) * 1000) : undefined,
				message: message.trim(),
			});
		}
		return commits;
	}

	async commit(message: string, opts?: GitCommitOptions): Promise<void> {
		const args = ['commit'];
		if (opts?.all === true) {
			args.push('--all');
		}
		if (opts?.amend) {
			args.push('--amend');
		}
		if (opts?.signoff) {
			args.push('--signoff');
		}
		if (opts?.signCommit) {
			args.push('-S');
		}
		if (opts?.empty) {
			args.push('--allow-empty');
		}
		if (opts?.noVerify) {
			args.push('--no-verify');
		}
		if (message) {
			args.push('-m', message);
		} else if (opts?.amend) {
			args.push('--no-edit');
		}
		await execGitOrThrow(args, this._cwd);
		this._onDidCommit.fire();
		await this.status();
	}

	async merge(ref: string): Promise<void> {
		await execGitOrThrow(['merge', ref], this._cwd);
		await this.status();
	}

	async mergeAbort(): Promise<void> {
		await execGitOrThrow(['merge', '--abort'], this._cwd);
		await this.status();
	}
}

export class ScCodeGitExtensionHostBridge extends Disposable {
	private readonly _repositories = new Map<string, ScCodeGitRepository>();
	private readonly _onDidOpenRepository = this._register(new Emitter<ScCodeGitRepository>());
	private readonly _onDidCloseRepository = this._register(new Emitter<ScCodeGitRepository>());
	private readonly _onDidChangeState = this._register(new Emitter<'uninitialized' | 'initialized'>());
	private readonly _onDidPublish = this._register(new Emitter<{ repository: ScCodeGitRepository; branch?: string }>());
	private readonly _onDidChangeEnablement = this._register(new Emitter<boolean>());

	private _state: 'uninitialized' | 'initialized' = 'uninitialized';
	private _gitPath = 'git';
	private _initPromise: Promise<void> | undefined;

	constructor(
		private readonly _extHostWorkspace: IExtHostWorkspace,
		private readonly _extHostFileSystemEvent: ExtHostFileSystemEventService,
		private readonly _extHostCommands: IExtHostCommands,
		private readonly _logService: ILogService,
	) {
		super();

		this._register(this._extHostWorkspace.onDidChangeWorkspace(() => {
			void this._scanWorkspaceFolders();
		}));

		void this._extHostFileSystemEvent;

		try {
			this._register(this._extHostCommands.registerCommand(false, 'git.api.getRepositories', (): any => {
				return Array.from(this._repositories.values()).map(r => r.rootUri);
			}));
			this._register(this._extHostCommands.registerCommand(false, 'git.api.getRepositoryState', (uri?: vscode.Uri): any => {
				const repo = uri ? this.getRepository(uri) : Array.from(this._repositories.values())[0];
				return repo?.state;
			}));
			this._register(this._extHostCommands.registerCommand(false, 'git.api.getRemoteSources', (): any => {
				return [];
			}));
		} catch {
			// Commands may already be registered by another component
		}

		void this.ensureInitialized();
	}

	ensureInitialized(): Promise<void> {
		if (!this._initPromise) {
			this._initPromise = this._initialize();
		}
		return this._initPromise;
	}

	private async _initialize(): Promise<void> {
		try {
			const whichRes = await execGit(['--exec-path']);
			if (whichRes.exitCode === 0) {
				this._gitPath = 'git';
			}
		} catch {
			// Ignore
		}
		await this._scanWorkspaceFolders();
		if (this._state !== 'initialized') {
			this._state = 'initialized';
			this._onDidChangeState.fire('initialized');
		}
	}

	private async _scanWorkspaceFolders(): Promise<void> {
		const folders = this._extHostWorkspace.getWorkspaceFolders() ?? [];
		const discoveredRoots = new Map<string, URI>();

		for (const folder of folders) {
			if (folder.uri.scheme !== 'file') {
				continue;
			}
			const res = await execGit(['rev-parse', '--show-toplevel'], folder.uri.fsPath);
			if (res.exitCode === 0 && res.stdout.trim()) {
				const rootUri = URI.file(res.stdout.trim());
				discoveredRoots.set(rootUri.fsPath.toLowerCase(), rootUri);
			}
		}

		for (const [key, existing] of this._repositories) {
			if (!discoveredRoots.has(key)) {
				this._repositories.delete(key);
				this._onDidCloseRepository.fire(existing);
				existing.dispose();
			}
		}

		for (const [key, rootUri] of discoveredRoots) {
			if (!this._repositories.has(key)) {
				const repo = new ScCodeGitRepository(rootUri, this._logService);
				this._repositories.set(key, repo);
				await repo.status();
				this._onDidOpenRepository.fire(repo);
			}
		}
	}

	getRepository(uri: vscode.Uri): ScCodeGitRepository | null {
		const targetUri = URI.isUri(uri) ? uri : URI.parse(String(uri));
		let bestMatch: ScCodeGitRepository | null = null;
		for (const repo of this._repositories.values()) {
			if (isEqualOrParent(targetUri, repo.rootUri, true)) {
				if (!bestMatch || repo.rootUri.fsPath.length > bestMatch.rootUri.fsPath.length) {
					bestMatch = repo;
				}
			}
		}
		return bestMatch;
	}

	async openRepository(root: vscode.Uri): Promise<ScCodeGitRepository | null> {
		const rootUri = URI.isUri(root) ? root : URI.parse(String(root));
		if (rootUri.scheme !== 'file') {
			return null;
		}
		const res = await execGit(['rev-parse', '--show-toplevel'], rootUri.fsPath);
		if (res.exitCode !== 0 || !res.stdout.trim()) {
			return null;
		}
		const topUri = URI.file(res.stdout.trim());
		const key = topUri.fsPath.toLowerCase();
		let repo = this._repositories.get(key);
		if (!repo) {
			repo = new ScCodeGitRepository(topUri, this._logService);
			this._repositories.set(key, repo);
			await repo.status();
			this._onDidOpenRepository.fire(repo);
		}
		return repo;
	}

	async init(root: vscode.Uri): Promise<ScCodeGitRepository | null> {
		const rootUri = URI.isUri(root) ? root : URI.parse(String(root));
		if (rootUri.scheme !== 'file') {
			return null;
		}
		const res = await execGit(['init'], rootUri.fsPath);
		if (res.exitCode !== 0) {
			return null;
		}
		return this.openRepository(rootUri);
	}

	createAPI(version: number): unknown {
		if (version !== 1) {
			throw new Error(`Noagra git API version ${version} is not supported.`);
		}
		const self = this;
		const disposables = new DisposableStore();
		return {
			get state() { return self._state; },
			onDidChangeState: self._onDidChangeState.event,
			onDidPublish: self._onDidPublish.event,
			get git() { return { path: self._gitPath }; },
			get repositories() { return Array.from(self._repositories.values()); },
			onDidOpenRepository: self._onDidOpenRepository.event,
			onDidCloseRepository: self._onDidCloseRepository.event,
			toGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
				return toGitUri(uri, ref);
			},
			getRepository(uri: vscode.Uri) {
				return self.getRepository(uri);
			},
			async getRepositoryRoot(uri: vscode.Uri): Promise<vscode.Uri | null> {
				const existing = self.getRepository(uri);
				if (existing) {
					return existing.rootUri;
				}
				const targetUri = URI.isUri(uri) ? uri : URI.parse(String(uri));
				if (targetUri.scheme !== 'file') {
					return null;
				}
				const fsMod = getNodeFsModule();
				let cwd = targetUri.fsPath;
				try {
					if (fsMod && fsMod.statSync(cwd).isFile()) {
						cwd = dirname(targetUri).fsPath;
					}
				} catch {
					cwd = dirname(targetUri).fsPath;
				}
				const res = await execGit(['rev-parse', '--show-toplevel'], cwd);
				return res.exitCode === 0 && res.stdout.trim() ? URI.file(res.stdout.trim()) : null;
			},
			async getRepositoryWorkspace(uri: vscode.Uri): Promise<vscode.Uri[] | null> {
				const repo = self.getRepository(uri);
				return repo ? [repo.rootUri] : null;
			},
			init(root: vscode.Uri) {
				return self.init(root);
			},
			openRepository(root: vscode.Uri) {
				return self.openRepository(root);
			},
			registerRemoteSourceProvider(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerRemoteSourcePublisher(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerCredentialsProvider(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerPostCommitCommandsProvider(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerPushErrorHandler(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerBranchProtectionProvider(): vscode.Disposable {
				return toDisposable(() => { });
			},
			registerSourceControlHistoryItemDetailsProvider(): vscode.Disposable {
				return toDisposable(() => { });
			},
			dispose() {
				disposables.dispose();
			},
		};
	}

	createGitExtensionExports(): {
		readonly enabled: boolean;
		readonly onDidChangeEnablement: Event<boolean>;
		getAPI(version: number): unknown;
	} {
		const self = this;
		return {
			enabled: true,
			onDidChangeEnablement: this._onDidChangeEnablement.event,
			getAPI(version: number) {
				return self.createAPI(version);
			},
		};
	}

	createSyntheticVscodeExtension(extensionKind: vscode.ExtensionKind): vscode.Extension<any> {
		const self = this;
		const exports = this.createGitExtensionExports();
		const extensionUri = URI.file(this._extHostWorkspace.getWorkspaceFolders()?.[0]?.uri.fsPath ?? '/');
		const packageJSON = {
			identifier: new ExtensionIdentifier('vscode.git'),
			name: 'git',
			publisher: 'vscode',
			version: '1.0.0',
			engines: { vscode: '*' },
			isBuiltin: true,
			isUserBuiltin: false,
			isUnderDevelopment: false,
			extensionLocation: extensionUri,
			targetPlatform: 'universal',
		};
		return {
			id: 'vscode.git',
			extensionUri,
			extensionPath: extensionUri.fsPath,
			isActive: true,
			packageJSON,
			extensionKind: extensionKind ?? extHostTypes.ExtensionKind.Workspace,
			isFromDifferentExtensionHost: false,
			exports,
			async activate() {
				await self.ensureInitialized();
				return exports;
			},
		} as vscode.Extension<any>;
	}
}
