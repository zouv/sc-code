/*---------------------------------------------------------------------------------------------
 *  ScCode Complete — Agent prefix/suffix contract or external OpenAI FIM adapter.
 *  All requests go through the Tauri proxy to avoid CORS / mixed-content
 *  browser restrictions.
 *--------------------------------------------------------------------------------------------*/

import { invoke, isTauri } from '../../../../scCodeBridge.js';
import { getServerEndpoint, localServerHeaders } from '../../scCodeChat/browser/localServer.js';
import { ICompletionContext } from './contextEngine.js';

export interface ICompletionRequest {
	prefix: string;
	suffix: string;
	language: string;
	filePath: string;
	maxTokens: number;
	context?: ICompletionContext;
}

export interface ICompletionResponse {
	text: string;
	finishReason: string;
	logprobs?: number[];
}

export interface IStreamingCallback {
	onToken(accumulated: string): void;
}

const TIMEOUT_MS = 3_000;
const STREAM_TIMEOUT_MS = 8_000;
const STOP_TOKENS = ['<|endoftext|>', '\n\n\n'];

export class ScCodeCompleteService {

	/**
	 * Resolved per request rather than captured: the local agent server picks a
	 * fresh port every time it restarts, so a URL captured at construction goes
	 * stale the first time credentials change.
	 */
	constructor(private readonly _baseUrl: () => Promise<string>) { }

	private _usesAgent(url: string): boolean {
		return new URL(url).origin === new URL(getServerEndpoint().httpUrl).origin;
	}

	private _agentBody(request: ICompletionRequest): string {
		return JSON.stringify({ prefix: request.prefix, suffix: request.suffix, file_path: request.filePath, language: request.language });
	}

	private async _proxyPost(url: string, body: string, signal?: AbortSignal): Promise<string | null> {
		if (signal?.aborted) { return null; }
		if (isTauri()) {
			try {
				const result = await invoke<string>('proxy_request', {
					url,
					method: 'POST',
					headers: { 'Content-Type': 'application/json', ...localServerHeaders(url) },
					body,
				});
				return signal?.aborted ? null : result;
			} catch (e) {
				console.warn('[sc-code-complete] Tauri proxy failed, falling back to fetch:', e);
			}
		}
		const resp = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...localServerHeaders(url) },
			body,
			signal,
		});
		if (!resp.ok) {
			console.warn('[sc-code-complete] fetch failed:', resp.status);
			return null;
		}
		const text = await resp.text();
		console.log('[sc-code-complete] fetch response length:', text.length);
		return text;
	}

	async complete(request: ICompletionRequest, signal?: AbortSignal): Promise<ICompletionResponse | null> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

		const abort = () => controller.abort();
		if (signal?.aborted) { controller.abort(); }
		signal?.addEventListener('abort', abort, { once: true });

		try {
			const prompt = this._buildFimPrompt(request);
			const url = `${await this._baseUrl()}/v1/completions`;
			const body = this._usesAgent(url) ? this._agentBody(request) : JSON.stringify({
				model: 'sc-code-complete',
				prompt,
				max_tokens: request.maxTokens,
				temperature: 0,
				stop: STOP_TOKENS,
				logprobs: 5,
			});

			const rawJson = await this._proxyPost(url, body, controller.signal);
			if (!rawJson) {
				return null;
			}

			const data = JSON.parse(rawJson);

			return this._parseNonStreamingResponse(data);
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener('abort', abort);
		}
	}

	async completeStreaming(
		request: ICompletionRequest,
		callback: IStreamingCallback,
		signal?: AbortSignal,
	): Promise<ICompletionResponse | null> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

		const abort = () => controller.abort();
		if (signal?.aborted) { controller.abort(); }
		signal?.addEventListener('abort', abort, { once: true });

		try {
			const prompt = this._buildFimPrompt(request);
			const url = `${await this._baseUrl()}/v1/completions`;

			// The agent returns a single non-streaming completion, not OpenAI SSE.
			if (this._usesAgent(url)) {
				const raw = await this._proxyPost(url, this._agentBody(request), controller.signal);
				const result = raw ? this._parseNonStreamingResponse(JSON.parse(raw)) : null;
				if (result) { callback.onToken(result.text); }
				return result;
			}

			const bodyPayload = JSON.stringify({
				model: 'sc-code-complete',
				prompt,
				max_tokens: request.maxTokens,
				temperature: 0,
				stop: STOP_TOKENS,
				logprobs: 5,
				stream: true,
			});

			// Tauri invoke cannot stream, so fall back to non-streaming via proxy
			if (isTauri()) {
				const nonStreamBody = JSON.stringify({
					model: 'sc-code-complete',
					prompt,
					max_tokens: request.maxTokens,
					temperature: 0,
					stop: STOP_TOKENS,
					logprobs: 5,
				});
				const rawJson = await this._proxyPost(url, nonStreamBody, controller.signal);
				if (!rawJson) {
					return null;
				}
				const data = JSON.parse(rawJson) as {
					choices?: Array<{
						text?: string;
						finish_reason?: string;
						logprobs?: { token_logprobs?: number[] };
					}>;
				};
				const result = this._parseNonStreamingResponse(data);
				if (result) {
					callback.onToken(result.text);
				}
				return result;
			}

			const resp = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...localServerHeaders(url) },
				body: bodyPayload,
				signal: controller.signal,
			});

			if (!resp.ok) {
				return null;
			}

			const body = resp.body;
			if (!body) {
				return null;
			}

			let accumulated = '';
			const allLogprobs: number[] = [];
			let finishReason = 'stop';
			const reader = body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			for (;;) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.startsWith('data: ')) {
						continue;
					}
					const payload = line.slice(6).trim();
					if (payload === '[DONE]') {
						continue;
					}

					let parsed: {
						choices?: Array<{
							text?: string;
							finish_reason?: string | null;
							logprobs?: { token_logprobs?: number[] };
						}>;
					};
					try {
						parsed = JSON.parse(payload);
					} catch {
						continue;
					}

					const choice = parsed.choices?.[0];
					if (!choice?.text) {
						continue;
					}

					accumulated += choice.text;

					if (choice.logprobs?.token_logprobs) {
						allLogprobs.push(...choice.logprobs.token_logprobs);
					}

					if (choice.finish_reason) {
						finishReason = choice.finish_reason;
					}

					callback.onToken(accumulated);
				}
			}

			let text = accumulated;
			for (const tok of STOP_TOKENS) {
				text = text.replaceAll(tok, '');
			}
			text = text.replace(/\s+$/, '');

			if (!text) {
				return null;
			}

			return {
				text,
				finishReason,
				logprobs: allLogprobs.length > 0 ? allLogprobs : undefined,
			};
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
			signal?.removeEventListener('abort', abort);
		}
	}

	private _parseNonStreamingResponse(data: {
		completion?: string;
		choices?: Array<{
			text?: string;
			finish_reason?: string;
			logprobs?: { token_logprobs?: number[] };
		}>;
	}): ICompletionResponse | null {
		const choice = data.choices?.[0] ?? (typeof data.completion === 'string' ? { text: data.completion, finish_reason: 'stop', logprobs: undefined } : undefined);
		if (!choice?.text) {
			return null;
		}

		let text = choice.text;
		for (const tok of STOP_TOKENS) {
			text = text.replaceAll(tok, '');
		}
		text = text.trimEnd();
		while (text.startsWith('\n')) {
			text = text.slice(1);
		}

		if (!text.trim()) {
			return null;
		}

		return {
			text,
			finishReason: choice.finish_reason ?? 'stop',
			logprobs: choice.logprobs?.token_logprobs,
		};
	}

	private _buildFimPrompt(request: ICompletionRequest): string {
		const parts: string[] = [];

		if (request.suffix) {
			const suffixSnippet = request.suffix.slice(0, 200).trim();
			if (suffixSnippet) {
				parts.push(`// [context: code after cursor]\n// ${suffixSnippet.split('\n').slice(0, 3).join('\n// ')}\n`);
			}
		}

		parts.push(request.prefix);
		return parts.join('');
	}
}
