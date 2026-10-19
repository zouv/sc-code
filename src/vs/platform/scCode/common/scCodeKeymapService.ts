/*---------------------------------------------------------------------------------------------
 *  ScCode Keymap Service
 *  Routes default-keybinding reads through the Rust `sc-code-keymap` crate.
 *
 *  Registration note: VS Code's IKeybindingService (platform/keybinding/
 *  common/keybinding.ts) owns live keybinding resolution / dispatch and is
 *  not replaced here. This bridge exposes raw binding data under its own
 *  decorator; a future adapter could feed it into IKeybindingService as a
 *  custom keybindings-reader source.
 *--------------------------------------------------------------------------------------------*/

import { invoke } from '../../../scCodeBridge.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';

export interface KeybindingInfo {
	key: string;
	command: string;
	when: string | null;
	source: string;
}

export const IScCodeKeymapService = createDecorator<IScCodeKeymapService>('scCodeKeymapService');

export interface IScCodeKeymapService extends ScCodeKeymapService {
	readonly _serviceBrand: undefined;
}

export class ScCodeKeymapService {
	declare readonly _serviceBrand: undefined;
	async getDefaults(): Promise<KeybindingInfo[]> {
		try {
			return (await invoke('keymap_get_defaults')) || [];
		} catch {
			return [];
		}
	}

	async getAll(): Promise<KeybindingInfo[]> {
		try {
			return (await invoke('keymap_get_all')) || [];
		} catch {
			return [];
		}
	}
}

registerSingleton(IScCodeKeymapService, ScCodeKeymapService, InstantiationType.Delayed);
