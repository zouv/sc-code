/*---------------------------------------------------------------------------------------------
 *  Tab section for ScCode Settings panel.
 *  Controls for Cursor Tab completions, partial accepts, imports, and ignored files.
 *--------------------------------------------------------------------------------------------*/

import type { SettingsSection } from '../scCodeSettingsPanel.js';

type TauriInvoke = ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null;

interface SettingsData {
	[key: string]: unknown;
}

export class TabSection implements SettingsSection {
	private _container: HTMLElement | null = null;
	private _invoke: TauriInvoke;
	private _settings: SettingsData = {};

	constructor(invoke: TauriInvoke) {
		this._invoke = invoke;
	}

	async render(container: HTMLElement): Promise<void> {
		this._container = container;

		if (this._invoke) {
			try {
				const data = await this._invoke('settings_get', { section: 'sc-code.tab' }) as SettingsData | null;
				if (data) { this._settings = data; }
			} catch { /* use defaults */ }
		}

		const title = document.createElement('div');
		title.className = 'sc-code-settings-section-title';
		title.textContent = 'Tab';
		container.appendChild(title);

		this._renderCompletionSettings(container);
		this._renderImportSettings(container);
		this._renderIgnoredFiles(container);
	}

	private _renderCompletionSettings(container: HTMLElement): void {
		const card = this._createCard(container);

		this._createToggleRow(card, 'ScCode Tab', 'Context-aware multi-line code suggestions as you type',
			'sc-code.tab.cursorTab', this._getSetting('cursorTab', true) as boolean);

		this._createToggleRow(card, 'Partial Accepts', 'Accept the next word of a suggestion via Cmd+\u2192',
			'sc-code.tab.partialAccepts', this._getSetting('partialAccepts', false) as boolean);

		this._createToggleRow(card, 'Suggestions While Commenting', 'Allow Tab completions in comment regions',
			'sc-code.tab.suggestionsWhileCommenting', this._getSetting('suggestionsWhileCommenting', true) as boolean);

		this._createToggleRow(card, 'Whitespace-Only Suggestions', 'Allow suggestions that only change whitespace',
			'sc-code.tab.whitespaceOnlySuggestions', this._getSetting('whitespaceOnlySuggestions', false) as boolean);
	}

	private _renderImportSettings(container: HTMLElement): void {
		const sectionTitle = document.createElement('div');
		sectionTitle.className = 'sc-code-settings-section-title';
		sectionTitle.textContent = 'Imports';
		sectionTitle.style.marginTop = '24px';
		container.appendChild(sectionTitle);

		const card = this._createCard(container);

		this._createToggleRow(card, 'Imports', 'Automatically import necessary modules for TypeScript',
			'sc-code.tab.imports', this._getSetting('imports', true) as boolean);

		this._createToggleRowWithBadge(card, 'Auto Import for Python', 'Automatically add import statements for Python files',
			'sc-code.tab.autoImportPython', this._getSetting('autoImportPython', false) as boolean, 'BETA');
	}

	private _renderIgnoredFiles(container: HTMLElement): void {
		const sectionTitle = document.createElement('div');
		sectionTitle.className = 'sc-code-settings-section-title';
		sectionTitle.textContent = 'Ignored Files';
		sectionTitle.style.marginTop = '24px';
		container.appendChild(sectionTitle);

		const card = this._createCard(container);

		const row = document.createElement('div');
		row.className = 'sc-code-settings-row';
		row.style.flexDirection = 'column';
		row.style.alignItems = 'stretch';
		row.style.gap = '8px';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sc-code-settings-row-label';
		lbl.textContent = 'Ignored Files';
		left.appendChild(lbl);

		const desc = document.createElement('div');
		desc.className = 'sc-code-settings-row-description';
		desc.textContent = 'Glob patterns for files where Tab completions should be disabled';
		left.appendChild(desc);
		row.appendChild(left);

		const wrapper = document.createElement('div');
		wrapper.className = 'sc-code-input-wrapper';
		const input = document.createElement('input');
		input.type = 'text';
		input.value = (this._getSetting('ignoredFiles', '') as string);
		input.placeholder = 'e.g., *.md, **/generated/';
		input.addEventListener('change', () => this._saveSetting('sc-code.tab.ignoredFiles', input.value));
		wrapper.appendChild(input);
		row.appendChild(wrapper);

		card.appendChild(row);
	}

	// --- Helpers ---

	private _getSetting(key: string, defaultValue: unknown): unknown {
		return this._settings[key] ?? defaultValue;
	}

	private _saveSetting(key: string, value: unknown): void {
		if (!this._invoke) { return; }
		this._invoke('settings_update', { key, value: JSON.stringify(value), scope: 'user' }).catch(() => {});
	}

	private _createCard(parent: HTMLElement): HTMLElement {
		const card = document.createElement('div');
		card.className = 'sc-code-settings-card';
		parent.appendChild(card);
		return card;
	}

	private _createToggleRow(parent: HTMLElement, label: string, description: string, settingKey: string, initialState: boolean): void {
		const row = document.createElement('div');
		row.className = 'sc-code-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sc-code-settings-row-label';
		lbl.textContent = label;
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sc-code-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sc-code-settings-row-action';
		const toggle = document.createElement('div');
		toggle.className = 'sc-code-settings-toggle' + (initialState ? ' on' : '');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle('on');
			this._saveSetting(settingKey, toggle.classList.contains('on'));
		});
		action.appendChild(toggle);
		row.appendChild(action);

		parent.appendChild(row);
	}

	private _createToggleRowWithBadge(parent: HTMLElement, label: string, description: string, settingKey: string, initialState: boolean, badgeText: string): void {
		const row = document.createElement('div');
		row.className = 'sc-code-settings-row';

		const left = document.createElement('div');
		const lbl = document.createElement('div');
		lbl.className = 'sc-code-settings-row-label';
		lbl.textContent = label;

		const badge = document.createElement('span');
		badge.style.cssText = 'display:inline-block;margin-left:8px;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;letter-spacing:0.5px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);vertical-align:middle;';
		badge.textContent = badgeText;
		lbl.appendChild(badge);
		left.appendChild(lbl);

		if (description) {
			const desc = document.createElement('div');
			desc.className = 'sc-code-settings-row-description';
			desc.textContent = description;
			left.appendChild(desc);
		}
		row.appendChild(left);

		const action = document.createElement('div');
		action.className = 'sc-code-settings-row-action';
		const toggle = document.createElement('div');
		toggle.className = 'sc-code-settings-toggle' + (initialState ? ' on' : '');
		toggle.addEventListener('click', () => {
			toggle.classList.toggle('on');
			this._saveSetting(settingKey, toggle.classList.contains('on'));
		});
		action.appendChild(toggle);
		row.appendChild(action);

		parent.appendChild(row);
	}

	dispose(): void {
		this._container = null;
	}
}
