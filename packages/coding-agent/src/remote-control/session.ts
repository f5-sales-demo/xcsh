import { createHash } from "node:crypto";
import type { AgentMessage, ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
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
	| "getQueuedMessages"
	| "thinkingLevel"
	| "setThinkingLevel"
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
	error: { message: string; codexErrorInfo: null; additionalDetails: null } | null;
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
function turnError() {
	return {
		message: "The selected model could not complete this turn. Check the terminal for details.",
		codexErrorInfo: null,
		additionalDetails: null,
	};
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
	#clientIds = new Map<string, string>();
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
					clientId: this.#clientIds.get(current.id) ?? null,
					content: [{ type: "text", text: textOf(message), text_elements: [] }],
				});
				turns.push(current);
			} else if (message.role === "assistant" && turns.length) {
				if (message.stopReason === "error") {
					turns[turns.length - 1].status = "failed";
					turns[turns.length - 1].error = turnError();
				} else if (message.stopReason === "aborted") turns[turns.length - 1].status = "interrupted";
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
			supportedReasoningEfforts:
				this.target.model?.thinking?.supportedLevels.map(level => ({
					reasoningEffort: level.effort,
					description: level.description,
				})) ?? [],
			defaultReasoningEffort: this.target.model?.thinking?.defaultLevel ?? null,
			reasoningEffort:
				this.target.thinkingLevel === "off"
					? "none"
					: this.target.thinkingLevel === "inherit"
						? null
						: (this.target.thinkingLevel ?? null),
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
		if ((method === "turn/start" || method === "turn/steer") && typeof params.clientUserMessageId === "string")
			identity = `client-message:${params.clientUserMessageId}`;
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
		if (method === "thread/goal/get") return { goal: null };
		if (method === "thread/queue/list") {
			const limit = params.limit ?? 100;
			if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)
				throw new ProtocolError(-32602, "Invalid queue limit");
			const queued = this.target.getQueuedMessages();
			const counts = new Map<string, number>();
			const data = [...queued.steering, ...queued.followUp].map(text => {
				const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
				const count = counts.get(hash) ?? 0;
				counts.set(hash, count + 1);
				const id = `${this.target.sessionId}-queued-${hash}-${count}`;
				return { id, clientUserMessageId: id, input: [{ type: "text", text, text_elements: [] }] };
			});
			const start = params.cursor == null ? 0 : data.findIndex(item => item.id === params.cursor);
			if (start < 0) throw new ProtocolError(-32602, "Invalid queue cursor");
			return {
				data: data.slice(start, start + (limit as number)),
				nextCursor: data[start + (limit as number)]?.id ?? null,
			};
		}
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
				reasoningEffort:
					this.target.thinkingLevel === "off"
						? "none"
						: this.target.thinkingLevel === "inherit"
							? null
							: (this.target.thinkingLevel ?? null),
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
			throw new ProtocolError(-32601, "Unsupported xcsh remote method");
		for (const key of Object.keys(params))
			if (
				![
					"threadId",
					"input",
					"expectedTurnId",
					"clientUserMessageId",
					"model",
					"cwd",
					"effort",
					"summary",
				].includes(key) &&
				params[key] != null
			)
				throw new ProtocolError(-32602, "Unsupported turn override");
		if (
			!Array.isArray(params.input) ||
			!params.input.length ||
			params.input.some(item => item?.type !== "text" || typeof item.text !== "string")
		)
			throw new ProtocolError(-32602, "Unsupported turn input; text required");
		if (params.model != null && params.model !== this.target.model?.id)
			throw new ProtocolError(-32602, "Unsupported model override; use the terminal's selected model");
		if (params.cwd != null && params.cwd !== this.target.sessionManager.getCwd())
			throw new ProtocolError(-32602, "Unsupported working directory override");
		if (
			params.clientUserMessageId != null &&
			(typeof params.clientUserMessageId !== "string" ||
				!params.clientUserMessageId ||
				params.clientUserMessageId.length > 256)
		)
			throw new ProtocolError(-32602, "Invalid client message identity");
		if (
			params.effort != null &&
			!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(params.effort))
		)
			throw new ProtocolError(-32602, "Unsupported reasoning effort");
		// Summary controls reasoning presentation. This adapter exposes visible text
		// only, so all recognized presentation preferences retain that behavior.
		if (params.summary != null && !["auto", "concise", "detailed", "none"].includes(String(params.summary)))
			throw new ProtocolError(-32602, "Unsupported reasoning summary");
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
		if (params.effort != null) {
			try {
				this.target.setThinkingLevel((params.effort === "none" ? "off" : params.effort) as ThinkingLevel);
			} catch {
				throw new ProtocolError(-32602, "Selected model does not support that reasoning effort");
			}
		}
		const active = turn(`${this.target.sessionId}-turn-${this.history().length + 1}`, "inProgress");
		if (typeof params.clientUserMessageId === "string") this.#clientIds.set(active.id, params.clientUserMessageId);
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
		const latest = this.history().at(-1);
		if (status === "completed" && (latest?.status === "failed" || latest?.status === "interrupted"))
			status = latest.status;
		this.#active = undefined;
		this.#emit("turn/completed", {
			turn: {
				...active,
				status,
				error: status === "failed" ? turnError() : null,
				items: latest?.items ?? [],
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
