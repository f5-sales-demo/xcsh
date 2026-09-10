import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
export type SessionTarget = Pick<
	AgentSession,
	| "sessionId"
	| "sessionName"
	| "sessionFile"
	| "model"
	| "messages"
	| "isStreaming"
	| "sessionManager"
	| "subscribe"
	| "prompt"
	| "steer"
	| "abort"
>;
export interface Notification {
	method: string;
	params: Record<string, unknown>;
}
export class ProtocolError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}
interface Turn {
	id: string;
	items: Record<string, unknown>[];
	itemsView: string;
	status: string;
	error: null;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
}
function textOf(message: AgentMessage): string {
	if (!("content" in message)) return "";
	return typeof message.content === "string"
		? message.content
		: message.content
				.filter(part => part.type === "text")
				.map(part => part.text)
				.join("\n");
}
function turn(id: string, status = "completed"): Turn {
	return {
		id,
		items: [],
		itemsView: "full",
		status,
		error: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
	};
}
export class RemoteSession {
	#requests = new Map<string, { signature: string; result: Promise<unknown> }>();
	#listeners = new Set<(notification: Notification) => void>();
	#unsubscribe: () => void;
	#active?: Turn;
	#createdAt = Math.floor(Date.now() / 1000);
	#updatedAt = this.#createdAt;
	#itemId = "";
	constructor(
		readonly target: SessionTarget,
		private readonly version = "21.22.0",
	) {
		this.#unsubscribe = target.subscribe(event => this.#event(event));
	}
	subscribe(listener: (event: Notification) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	dispose(): void {
		this.#unsubscribe();
		this.#listeners.clear();
	}
	#emit(method: string, params: Record<string, unknown>): void {
		this.#updatedAt = Math.floor(Date.now() / 1000);
		for (const listener of this.#listeners)
			listener({ method, params: { threadId: this.target.sessionId, ...params } });
	}
	history(): Turn[] {
		const turns: Turn[] = [];
		this.target.messages.forEach((message, index) => {
			if (message.role === "user") {
				const current = turn(`${this.target.sessionId}-turn-${turns.length + 1}`);
				current.items.push({
					type: "userMessage",
					id: `${this.target.sessionId}-item-${index}`,
					clientId: null,
					content: [{ type: "text", text: textOf(message), text_elements: [] }],
				});
				turns.push(current);
			} else if (message.role === "assistant" && turns.length) {
				const text = textOf(message);
				if (text)
					turns[turns.length - 1].items.push(this.#assistantItem(`${this.target.sessionId}-item-${index}`, text));
			}
		});
		return turns;
	}
	#assistantItem(id: string, text: string) {
		return {
			type: "agentMessage",
			id,
			text,
			phase: "final_answer",
			memoryCitation: null,
			delivery: null,
			questions: null,
		};
	}
	thread(includeTurns = false) {
		return {
			id: this.target.sessionId,
			sessionId: this.target.sessionId,
			forkedFromId: null,
			parentThreadId: null,
			preview:
				this.target.messages
					.filter(m => m.role === "user")
					.map(textOf)[0]
					?.slice(0, 200) ?? "",
			ephemeral: !this.target.sessionFile,
			section: null,
			sectionEnteredAt: null,
			projectId: null,
			historyMode: "legacy",
			modelProvider: this.target.model?.provider ?? "unknown",
			model: this.target.model?.id ?? null,
			reasoningEffort: null,
			createdAt: this.#createdAt,
			updatedAt: this.#updatedAt,
			recencyAt: this.#updatedAt,
			status: this.target.isStreaming || this.#active ? { type: "active", activeFlags: [] } : { type: "idle" },
			path: this.target.sessionFile ?? null,
			cwd: this.target.sessionManager.getCwd(),
			cliVersion: this.version,
			source: "cli",
			threadSource: null,
			agentNickname: null,
			agentRole: null,
			gitInfo: null,
			name: this.target.sessionName ?? null,
			turns: includeTurns ? this.history() : [],
		};
	}
	call(identity: string, method: string, params: Record<string, unknown>): Promise<unknown> {
		const signature = JSON.stringify({ method, params });
		const existing = this.#requests.get(identity);
		if (existing)
			return existing.signature === signature
				? existing.result
				: Promise.reject(new ProtocolError(-32600, "Request identity reused with different input"));
		if (this.#requests.size >= 4096)
			return Promise.reject(
				new ProtocolError(-32000, "Session request limit reached; restart the remote attachment"),
			);
		const result = this.#execute(method, params);
		this.#requests.set(identity, { signature, result });
		return result;
	}
	async #execute(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (params.threadId !== this.target.sessionId) throw new ProtocolError(-32602, "Thread not found");
		if (method === "thread/read") return { thread: this.thread(params.includeTurns === true) };

		if (method === "thread/turns/list" || method === "thread/items/list") {
			const limit = params.limit ?? 20;
			if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)
				throw new ProtocolError(-32602, "Invalid history page size");
			const direction = params.sortDirection ?? "desc";
			if (direction !== "asc" && direction !== "desc")
				throw new ProtocolError(-32602, "Invalid history sort direction");
			const history = this.history();
			const entries: { key: string; value: unknown }[] =
				method === "thread/turns/list"
					? history.map(value => ({
							key: value.id,
							value: params.itemsView === "notLoaded" ? { ...value, items: [], itemsView: "notLoaded" } : value,
						}))
					: history.flatMap(value =>
							value.items.map(item => ({ key: String(item.id), value: { turnId: value.id, item } })),
						);
			if (direction === "desc") entries.reverse();
			const start = params.cursor == null ? 0 : entries.findIndex(entry => entry.key === params.cursor);
			if (start < 0) throw new ProtocolError(-32602, "Invalid history cursor");
			const page = entries.slice(start, start + (limit as number));
			return {
				data: page.map(entry => entry.value),
				nextCursor: entries[start + (limit as number)]?.key ?? null,
				backwardsCursor: page[0]?.key ?? null,
			};
		}
		if (method === "thread/resume") {
			for (const key of Object.keys(params))
				if (
					![
						"threadId",
						"persistExtendedHistory",
						"excludeTurns",
						"initialTurnsPage",
						"config",
						"cwd",
						"model",
						"modelProvider",
						"serviceTier",
						"approvalPolicy",
						"approvalsReviewer",
						"sandbox",
						"permissions",
						"runtimeWorkspaceRoots",
						"baseInstructions",
						"developerInstructions",
						"personality",
					].includes(key) &&
					params[key] != null
				)
					throw new ProtocolError(-32602, "Unsupported resume override");

			// A live terminal is already an observed writer. Like upstream loaded-thread
			// rejoin, resume cannot replace its runtime with the phone's default config.
			const history = this.history();
			const initialTurnsPage =
				params.initialTurnsPage == null
					? null
					: await this.#execute("thread/turns/list", {
							...(params.initialTurnsPage as Record<string, unknown>),
							threadId: this.target.sessionId,
						});
			return {
				runtimeWorkspaceRoots: [this.target.sessionManager.getCwd()],
				activePermissionProfile: null,
				multiAgentMode: "explicitRequestOnly",
				initialTurnsPage,
				thread: this.thread(params.excludeTurns !== true),
				model: this.target.model?.id ?? "",
				modelProvider: this.target.model?.provider ?? "",
				serviceTier: null,
				cwd: this.target.sessionManager.getCwd(),
				instructionSources: [],
				approvalPolicy: "never",
				approvalsReviewer: "user",
				sandbox: { type: "dangerFullAccess" },
				reasoningEffort: null,
				turnsBackwardsCursor: history.at(-1)?.id ?? null,
				itemsBackwardsCursor: history.at(-1)?.items.at(-1)?.id ?? null,
			};
		}
		if (method === "turn/interrupt") {
			if (!this.#active || params.turnId !== this.#active.id)
				throw new ProtocolError(-32602, "Active turn mismatch");
			await this.target.abort();
			return {};
		}
		if (method !== "turn/start" && method !== "turn/steer")
			throw new ProtocolError(-32601, "Unsupported XCSH remote method");
		for (const key of Object.keys(params))
			if (!["threadId", "input", "expectedTurnId"].includes(key) && params[key] != null)
				throw new ProtocolError(-32602, "Unsupported turn override");
		if (
			!Array.isArray(params.input) ||
			!params.input.length ||
			params.input.some(item => item?.type !== "text" || typeof item.text !== "string")
		)
			throw new ProtocolError(-32602, "Unsupported turn input; text required");
		const text = params.input.map(item => item.text).join("\n");
		if (!text.trim()) throw new ProtocolError(-32602, "Empty turn input");
		if (method === "turn/steer") {
			if (!this.#active || params.expectedTurnId !== this.#active.id)
				throw new ProtocolError(-32602, "Active turn mismatch");
			await this.target.steer(text);
			return { turnId: this.#active.id };
		}
		if (this.target.isStreaming || this.#active)
			throw new ProtocolError(-32000, "Session already running; use turn/steer");
		const active = turn(`${this.target.sessionId}-turn-${this.history().length + 1}`, "inProgress");
		this.#active = active;
		// The existing AgentSession remains the only executor and persistence owner.
		this.#emit("turn/started", { turn: active });
		void this.target.prompt(text).then(
			() => this.#finish("completed"),
			() => this.#finish("failed"),
		);
		return { turn: { ...active } };
	}
	#finish(status: string): void {
		if (!this.#active) return;
		const active = this.#active;
		this.#active = undefined;
		this.#emit("turn/completed", {
			turn: {
				...active,
				status,
				items: this.history().at(-1)?.items ?? [],
				completedAt: Math.floor(Date.now() / 1000),
			},
		});
	}
	#event(event: AgentSessionEvent): void {
		if (event.type === "agent_start" && !this.#active) {
			this.#active = turn(`${this.target.sessionId}-turn-${this.history().length + 1}`, "inProgress");
			this.#emit("turn/started", { turn: this.#active });
		}
		if (event.type === "message_start" && event.message.role === "assistant") {
			this.#itemId = `${this.target.sessionId}-item-${this.target.messages.length}`;
			this.#emit("item/started", { turnId: this.#active?.id, item: this.#assistantItem(this.#itemId, "") });
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta")
			this.#emit("item/agentMessage/delta", {
				turnId: this.#active?.id,
				itemId: this.#itemId,
				delta: event.assistantMessageEvent.delta,
			});
		if (event.type === "message_end" && event.message.role === "assistant")
			this.#emit("item/completed", {
				turnId: this.#active?.id,
				item: this.#assistantItem(this.#itemId, textOf(event.message)),
			});
		if (event.type === "agent_end") this.#finish("completed");
	}
}
