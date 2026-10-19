/*---------------------------------------------------------------------------------------------
 *  ScCode Editor Bridge
 *  Intercepts high-level editor operations and forwards them to the Rust
 *  `sc-code-editor` / `sc-code-text` crates via Tauri IPC.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '../../../scCodeBridge.js';

export class ScCodeEditorBridge {
	private static instance: ScCodeEditorBridge;

	static getInstance(): ScCodeEditorBridge {
		if (!ScCodeEditorBridge.instance) {
			ScCodeEditorBridge.instance = new ScCodeEditorBridge();
		}
		return ScCodeEditorBridge.instance;
	}

	// --- File operations (sc-code-text) ---

	async readFile(path: string): Promise<string> {
		return invoke<string>('read_file', { path });
	}

	async writeFile(path: string, content: string): Promise<void> {
		return invoke<void>('write_file', { path, content });
	}

	// --- Language detection (sc-code-syntax) ---

	async detectLanguage(filename: string): Promise<string> {
		try {
			return await invoke<string>('syntax_detect_language', { filename });
		} catch {
			return 'plaintext';
		}
	}

	// --- Git status (sc-code-git) ---

	async getGitStatus(repoRoot: string): Promise<any> {
		return invoke('git_status', { repoRoot });
	}

	// --- Search (sc-code-workspace) ---

	async searchInFiles(dir: string, query: string): Promise<any> {
		return invoke('search_text', { dir, query });
	}

	// --- Settings (sc-code-settings) ---

	async getSettings(section?: string): Promise<any> {
		return invoke('settings_get', { section: section ?? null });
	}

	// --- Theme (sc-code-theme) ---

	async getThemeList(): Promise<any[]> {
		return (await invoke<any[]>('theme_list')) ?? [];
	}

	async getThemeData(id: string): Promise<any> {
		return invoke('theme_get', { id });
	}
}
