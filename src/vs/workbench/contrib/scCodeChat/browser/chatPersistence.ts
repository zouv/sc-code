/*---------------------------------------------------------------------------------------------
 * Durable chat history writes. Each instance captures one session so in-flight
 * writes cannot be redirected by a renderer switching or clearing sessions.
 *--------------------------------------------------------------------------------------------*/

export interface IPersistableMessage {
	role: string;
	content: string;
	timestamp: number;
	toolCalls?: unknown;
}

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
interface Write {
	payload: Record<string, unknown>;
	saved: boolean;
	inFlight?: Promise<void>;
}

export class ChatSessionPersistence {
	private readonly _writes = new Map<IPersistableMessage, Write>();
	private _created: boolean;
	private _sequence = 0;
	private _creating: Promise<void> | undefined;

	constructor(
		private readonly _invoke: Invoke,
		private readonly _session: { id: string; title: string; model: string; mode: string; workspace: string },
		private readonly _onError: (error: unknown) => void,
		created = false,
		private readonly _delay: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
	) { this._created = created; }

	markSaved(msg: IPersistableMessage): void {
		this._writes.set(msg, { payload: {}, saved: true });
	}

	isSaved(msg: IPersistableMessage): boolean { return this._writes.get(msg)?.saved === true; }

	retryFailed(): void {
		for (const [msg, write] of this._writes) {
			if (!write.saved && !write.inFlight) { void this.save(msg); }
		}
	}

	private async _retry(work: () => Promise<unknown>): Promise<void> {
		for (let attempt = 0; ; attempt++) {
			try { await work(); return; } catch (error) {
				if (attempt >= 2) { throw error; }
				await this._delay(100 * (attempt + 1));
			}
		}
	}

	private _ensureCreated(): Promise<void> {
		if (this._created) { return Promise.resolve(); }
		if (!this._creating) {
			this._creating = this._retry(() => this._invoke('session_create', this._session))
				.then(() => { this._created = true; })
				.finally(() => { this._creating = undefined; });
		}
		return this._creating;
	}

	save(msg: IPersistableMessage): Promise<void> {
		let write = this._writes.get(msg);
		if (!write) {
			write = { saved: false, payload: {
				// SQLite stores seconds; the sortable ID preserves sub-second order
				// even when an earlier failed write arrives after a later message.
				id: this._session.id + '-msg-' + Math.floor(msg.timestamp).toString().padStart(16, '0')
					+ '-' + (this._sequence++).toString().padStart(8, '0') + '-' + crypto.randomUUID(),
				sessionId: this._session.id,
				role: msg.role, content: msg.content,
				toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
				toolCallId: null, createdAt: Math.floor(msg.timestamp / 1000),
			} };
			this._writes.set(msg, write);
		}
		if (write.saved) { return Promise.resolve(); }
		if (write.inFlight) { return write.inFlight; }
		const current = write;
		current.inFlight = this._ensureCreated()
			.then(() => this._retry(() => this._invoke('session_save_message', current.payload)))
			.then(() => { current.saved = true; })
			.catch(error => { this._onError(error); })
			.finally(() => { current.inFlight = undefined; });
		return current.inFlight;
	}
}
