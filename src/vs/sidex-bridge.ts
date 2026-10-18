/*---------------------------------------------------------------------------------------------
 *  ScCode — Low-level Tauri IPC bridge.
 *
 *  Uses the official `@tauri-apps/api/core` invoke implementation. The previous
 *  implementation relied on `window.__TAURI__`, which is only injected when
 *  `app.withGlobalTauri` is enabled; it is not, so every caller received `null`.
 *
 *  When running outside the Tauri webview (plain browser dev server) the bridge
 *  degrades gracefully: `invoke` returns `null` and logs a warning, matching the
 *  old contract.
 *--------------------------------------------------------------------------------------------*/

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
	return typeof globalThis !== 'undefined' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export async function invoke<T = any>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
	if (!isTauri()) {
		console.warn(`[ScCode] invoke(${cmd}) — Tauri not available`);
		return null as unknown as T;
	}
	return tauriInvoke<T>(cmd, args);
}

/**
 * Write a line to the host log file (`%LOCALAPPDATA%/<identifier>/logs`).
 * The workbench's own `ILogService` only reaches devtools; this bridge makes
 * native-integration diagnostics visible in dev and release builds.
 */
export function logToHost(level: number, message: string): void {
	if (!isTauri()) {
		return;
	}
	void tauriInvoke('plugin:log|log', { level, message }).catch(() => {
		// Logging must never break the caller.
	});
}
