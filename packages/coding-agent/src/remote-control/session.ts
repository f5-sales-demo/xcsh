import { createHash, randomUUID } from "node:crypto";
import { type AgentMessage, getToolExecutionKind, type ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "../session/agent-session";
import { ProtocolError } from "./errors";
import { updateFileHistoryItem } from "./file-changes";
import {
	activeToolHistoryItem,
	assistantHistoryItem,
	backgroundCommandCompletion,
	completeToolHistoryItem,
	messageHistoryItems,
	messageKey,
	projectHistory,
	projectHistorySnapshot,
	updateCommandHistoryItem,
} from "./history";
import { historyCursor, historyItemsView, historyPage, turnItemsView } from "./history-page";
import { RemoteInteractions } from "./interactions";
import { getSessionVoiceHistory, type SessionVoiceHistory } from "./session-voice-history";
import { timelinePage } from "./timeline";
import type { NativeVoice } from "./voice";
import type { VoiceOutputUpdate } from "./voice-handoff";
import { voiceInputText } from "./voice-input";
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
	| "setSessionName"
	| "modelRegistry"
	| "sendCustomMessage"
	| "setRealtimeMode"
> &
	Partial<
		Pick<
			AgentSession,
			| "getToolByName"
			| "getActiveToolExecutions"
			| "subscribeSessionTransitions"
			| "addBeforeDisposeHook"
			| "addBeforeUserInputHook"
			| "userInteractions"
			| "isSessionChanging"
			| "isDisposing"
		>
	>;
export interface Notification {
	id?: string;
	method: string;
	params: Record<string, unknown>;
}
export { ProtocolError } from "./errors";

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
	#epoch = 0;
	#boundId = "";
	#suspended = false;
	#disposed = false;
	#closing?: Promise<void>;
	#unsubscribeTransitions?: () => void;
	#unsubscribeDispose?: () => void;
	#interactions?: RemoteInteractions;
	#effects = new Set<Promise<unknown>>();
	#voiceHistoryOwner!: SessionVoiceHistory;
	#unsubscribeVoiceHistory?: () => void;
	#cancelDelegations = new Set<() => void>();
	#voiceOutputs = new Set<{ turnId: string; send: (update: VoiceOutputUpdate) => void }>();
	#voice?: NativeVoice;
	#requests = new Map<string, { signature: string; result: Promise<unknown> }>();
	#clientIds = new Map<string, string>();
	#listeners = new Set<(notification: Notification) => void>();
	#unsubscribe: () => void;
	#active?: Turn;
	#createdAt = Math.floor(Date.now() / 1000);
	#updatedAt = this.#createdAt;
	#itemId = "";
	#nextId = randomUUID();
	#startedItems = new Set<string>();
	#commandPreviews = new Map<string, Record<string, unknown>>();
	#commandSettlements = new Set<string>();
	#forwardedBackgroundProgress = new WeakSet<object>();
	#messageIds = new Map<string, string>();
	#pendingClients: { text: string; id: string }[] = [];
	#startedAtMs = 0;
	get #durable(): boolean {
		return typeof this.target.sessionManager.getBranch === "function";
	}
	constructor(
		readonly target: SessionTarget,
		private readonly version = "21.22.0",
	) {
		this.#restoreIdentity();
		this.#unsubscribe = target.subscribe(event => this.#event(event));
		if (target.userInteractions)
			this.#interactions = new RemoteInteractions(
				target.userInteractions,
				(toolCallId, interaction) => {
					if (this.#disposed || this.#suspended || this.#boundId !== target.sessionId) return undefined;
					if (interaction.planReview) {
						if (
							interaction.planReview.sessionId !== this.#boundId ||
							interaction.planReview.toolCallId !== toolCallId
						)
							return undefined;
						for (const turn of this.history().toReversed()) {
							const item = turn.items.findLast(
								value =>
									value.type === "dynamicToolCall" &&
									value.tool === "exit_plan_mode" &&
									value.status === "completed" &&
									String(value.id).endsWith(`:tool:${toolCallId}`),
							);
							if (item) return { threadId: this.#boundId, turnId: turn.id, itemId: String(item.id) };
						}
						return undefined;
					}
					if (!this.#active) return undefined;
					const item = this.#active.items.findLast(
						value =>
							["dynamicToolCall", "commandExecution", "fileChange"].includes(String(value.type)) &&
							value.status === "inProgress" &&
							String(value.id).endsWith(`:tool:${toolCallId}`),
					);
					return item
						? {
								threadId: this.#boundId,
								turnId: this.#active.id,
								itemId: String(item.id),
								startedAtMs: Date.now(),
								item,
							}
						: undefined;
				},
				event => {
					for (const listener of this.#listeners) listener(event);
				},
				(request, callId) => this.#voice?.mirrorText(voiceInputText(request, callId)),
				() => {
					void this.target.abort();
				},
			);
		this.#unsubscribeDispose = target.addBeforeDisposeHook?.(() => this.close());
		this.#unsubscribeTransitions = target.subscribeSessionTransitions?.(async phase => {
			if (phase === "before") {
				target.userInteractions?.cancelAll();
				this.#suspended = true;
				for (const cancel of this.#cancelDelegations) cancel();
				await this.#voice?.stop();
				await Promise.allSettled([...this.#effects]);
				await this.#voiceHistoryOwner.history.drain();
			} else {
				this.#epoch++;
				this.#voice = undefined;
				this.#active = undefined;
				this.#clientIds.clear();
				this.#messageIds.clear();
				this.#startedItems.clear();
				this.#pendingClients = [];
				this.#itemId = "";
				this.#nextId = randomUUID();
				this.#voiceOutputs.clear();
				this.#commandPreviews.clear();
				this.#commandSettlements.clear();
				this.#restoreIdentity();
				this.#suspended = false;
			}
		});
	}
	#restoreIdentity(): void {
		this.#boundId = this.target.sessionId;
		this.#unsubscribeVoiceHistory?.();
		this.#voiceHistoryOwner = getSessionVoiceHistory(this.target);
		this.#unsubscribeVoiceHistory = this.#voiceHistoryOwner.subscribe((method, params) =>
			this.#emitDirect(method, params, true),
		);
		const header = this.target.sessionManager.getHeader?.();
		this.#createdAt = header ? Math.floor(Date.parse(header.timestamp) / 1000) : Math.floor(Date.now() / 1000);
		const last = this.target.sessionManager.getBranch?.().at(-1);
		this.#updatedAt = last ? Math.floor(Date.parse(last.timestamp) / 1000) : this.#createdAt;
		if (this.#durable && this.target.isStreaming) {
			const latest = this.history().at(-1);
			if (latest?.status === "inProgress") {
				this.#active = latest;
				this.#startedAtMs = (latest.startedAt ?? this.#createdAt) * 1000;
			}
		}
	}
	#assertCurrent(epoch = this.#epoch, allowClosing = false): void {
		if (
			(this.#disposed && !allowClosing) ||
			epoch !== this.#epoch ||
			this.#boundId !== this.target.sessionId ||
			(!allowClosing && (this.#suspended || this.target.isSessionChanging || this.target.isDisposing))
		)
			throw new ProtocolError(-32000, "Session attachment is changing or closed");
	}
	async #effect<T>(epoch: number, action: () => Promise<T>): Promise<T> {
		this.#assertCurrent(epoch, true);
		const pending = action();
		this.#effects.add(pending);
		try {
			return await pending;
		} finally {
			this.#effects.delete(pending);
		}
	}

	subscribe(listener: (event: Notification) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	dispose(): void {
		void this.close();
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#suspended = true;
		this.#disposed = true;
		this.#unsubscribeTransitions?.();
		this.#unsubscribeDispose?.();
		for (const cancel of this.#cancelDelegations) cancel();
		this.#unsubscribe();
		this.#interactions?.close();
		this.#voiceOutputs.clear();
		this.#commandPreviews.clear();
		this.#commandSettlements.clear();
		this.#closing = Promise.resolve(this.#voice?.stop())
			.then(async () => {
				await Promise.allSettled([...this.#effects]);
				await this.#voiceHistoryOwner.history.drain();
			})
			.finally(() => {
				this.#epoch++;
				this.#listeners.clear();
				this.#unsubscribeVoiceHistory?.();
			});
		return this.#closing;
	}
	#emit(method: string, params: Record<string, unknown>, allowClosing = false): void {
		if ((this.#disposed && !allowClosing) || this.#boundId !== this.target.sessionId) return;
		const pending = this.#voiceHistoryOwner.dispatch(method, params, captured =>
			this.#emitDirect(method, captured, allowClosing),
		);
		if (pending) {
			this.#effects.add(pending);
			void pending
				.catch(() =>
					this.#emitDirect("thread/realtime/error", { message: "Could not persist backing voice history" }, true),
				)
				.finally(() => this.#effects.delete(pending));
		}
	}
	#emitDirect(method: string, params: Record<string, unknown>, allowClosing = false): void {
		if ((this.#disposed && !allowClosing) || this.#boundId !== this.target.sessionId) return;
		this.#updatedAt = Math.floor(Date.now() / 1000);
		for (const listener of this.#listeners)
			listener({ method, params: { threadId: this.target.sessionId, ...params } });
	}
	#cacheCommandPreview(item: Record<string, unknown>): void {
		const id = String(item.id);
		this.#commandPreviews.delete(id);
		this.#commandPreviews.set(id, item);
		if (this.#commandPreviews.size > 128) this.#commandPreviews.delete(this.#commandPreviews.keys().next().value!);
	}
	#overlayCommandPreviews(items: Record<string, unknown>[]): void {
		for (const item of items) {
			if (item.type !== "commandExecution") continue;
			const id = String(item.id);
			const preview = this.#commandPreviews.get(id);
			if (item.status === "inProgress" && preview) Object.assign(item, preview);
			else if (item.status !== "inProgress") this.#commandPreviews.delete(id);
		}
	}

	#replaceItem(target: Record<string, unknown>, source: Record<string, unknown>): void {
		if (target === source) return;
		for (const key of Object.keys(target)) delete target[key];
		Object.assign(target, source);
	}
	#overlayLiveHistory(turns: Turn[]): void {
		const active = turns.find(value => value.id === this.#active?.id);
		if (active && this.#active) {
			for (const item of this.#active.items) {
				const index = active.items.findIndex(value => value.id === item.id);
				if (index < 0) active.items.push(item);
				else this.#replaceItem(active.items[index], item);
			}
		}
		for (const execution of this.target.getActiveToolExecutions?.() ?? []) {
			const suffix = `:tool:${execution.toolCallId}`;
			const owner = turns.findLast(turn =>
				turn.items.some(item => item.status === "inProgress" && String(item.id).endsWith(suffix)),
			);
			const index = owner?.items.findLastIndex(
				item => item.status === "inProgress" && String(item.id).endsWith(suffix),
			);
			if (owner && index !== undefined && index >= 0)
				this.#replaceItem(owner.items[index], activeToolHistoryItem(owner.items[index], execution));
		}
		for (const value of turns) this.#overlayCommandPreviews(value.items);
	}

	history(): Turn[] {
		if (this.#durable) {
			const turns = projectHistory(
				this.target.sessionId,
				this.target.sessionManager.getBranch(),
				Boolean(this.#active) || this.target.isStreaming,
			);
			this.#overlayLiveHistory(turns);
			return turns;
		}
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
			preview: this.#durable
				? this.history()
						.flatMap(value => value.items)
						.filter(item => item.type === "userMessage")
						.slice(0, 1)
						.flatMap(item => item.content as { text?: string }[])
						.map(item => item.text ?? "")
						.join("\n")
						.slice(0, 200)
				: (this.target.messages
						.filter(m => m.role === "user")
						.map(textOf)[0]
						?.slice(0, 200) ?? ""),
			ephemeral: !this.target.sessionFile,
			section: null,
			sectionEnteredAt: null,
			projectId: null,
			historyMode: this.#durable ? "paginated" : "legacy",
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
	pendingRequests() {
		return this.#interactions?.pending() ?? [];
	}
	call(identity: string, method: string, params: Record<string, unknown>): Promise<unknown> {
		try {
			this.#assertCurrent();
			if (params.threadId !== this.#boundId) throw new ProtocolError(-32602, "Thread not found");
		} catch (error) {
			return Promise.reject(error);
		}
		if (method === "session/interaction/respond") {
			try {
				if (typeof params.requestId !== "string") throw new ProtocolError(-32602, "Invalid request identity");
				return Promise.resolve(
					this.#interactions?.respond(params.requestId, params.response) ?? { accepted: false },
				);
			} catch (error) {
				return Promise.reject(error);
			}
		}
		// Read RPC IDs are reusable after their response and must observe current state.
		// Reserve the deduplication budget for operations with side effects.
		if (
			[
				"thread/read",
				"thread/resume",
				"thread/turns/list",
				"thread/items/list",
				"thread/timeline/list",
				"thread/queue/list",
				"thread/goal/get",
			].includes(method)
		)
			return this.#execute(method, params);
		if ((method === "turn/start" || method === "turn/steer") && typeof params.clientUserMessageId === "string")
			identity = `client-message:${params.clientUserMessageId}`;
		// Keep accepted results when returning to a session, without colliding with
		// requests made under another session's identity in the same terminal.
		identity = JSON.stringify([this.#boundId, identity]);
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
		const epoch = this.#epoch;
		if (params.threadId !== this.target.sessionId) throw new ProtocolError(-32602, "Thread not found");
		if (method === "thread/name/set") {
			if (typeof params.name !== "string") throw new ProtocolError(-32602, "Invalid thread name");
			const name = params.name.trim();
			if (!name) throw new ProtocolError(-32602, "Thread name must not be empty");
			const stored = await this.#effect(epoch, async () => {
				const accepted = await this.target.setSessionName(name, "user");
				if (accepted) this.#emit("thread/name/updated", { threadName: this.target.sessionName ?? name });
				return accepted;
			});
			if (!stored) throw new ProtocolError(-32000, "Could not set thread name");
			return {};
		}
		if (method === "thread/realtime/stop") {
			await this.#voice?.stop();
			return {};
		}
		if (method === "thread/realtime/start") {
			const { NativeVoice } = await import("./voice");
			const { loadRemoteSubscription } = await import("./auth");
			this.#assertCurrent(epoch);
			if (this.#voice?.active) throw new ProtocolError(-32000, "Voice is already active");
			await this.#voice?.stop();
			this.#assertCurrent(epoch);
			this.#voice = new NativeVoice({
				history: this.#voiceHistoryOwner.history,
				context: () => {
					this.#assertCurrent(epoch);
					return JSON.stringify(
						this.target.messages
							.filter(message => message.role === "user" || message.role === "assistant")
							.map(message => ({ role: message.role, text: textOf(message) }))
							.slice(-30),
					);
				},
				modeChanged: (active, instructions) =>
					this.#effect(epoch, async () => {
						this.target.setRealtimeMode(active, instructions);
					}),
				authenticate: async () => {
					this.#assertCurrent(epoch);
					const auth = await loadRemoteSubscription(this.target.modelRegistry.authStorage, this.#boundId);
					this.#assertCurrent(epoch);
					return auth;
				},
				authenticateApiKey: async () => {
					this.#assertCurrent(epoch);
					const key = await this.target.modelRegistry.authStorage.getApiKeyFromNonOAuthSources(
						"openai",
						this.#boundId,
					);
					this.#assertCurrent(epoch);
					return key;
				},
				emit: (name, value) => {
					if (epoch === this.#epoch) this.#emit(name, value, true);
				},
				records: () => {
					this.#assertCurrent(epoch, true);
					return (this.target.sessionManager.getBranch?.() ?? this.target.sessionManager.getEntries()).flatMap(
						entry =>
							entry.type === "custom" &&
							entry.customType === "remote-realtime" &&
							entry.data &&
							typeof entry.data === "object"
								? [entry.data as Record<string, unknown>]
								: [],
					);
				},
				record: record =>
					this.#effect(epoch, async () => {
						this.target.sessionManager.appendCustomEntry("remote-realtime", record);
						await this.target.sessionManager.flush();
					}),
				delegate: (id, text, output) => {
					try {
						this.#assertCurrent(epoch);
					} catch (error) {
						return Promise.reject(error);
					}
					return this.#delegateVoice(id, text, output);
				},
			});
			await this.#voice.start(params);
			this.#assertCurrent(epoch);
			return {};
		}
		if (method === "thread/realtime/appendText" || method === "thread/realtime/appendSpeech") {
			if (!this.#voice) throw new ProtocolError(-32000, "Voice is not active");
			this.#voice.appendText(params.text, params.role ?? "user", method.endsWith("appendSpeech"));
			return {};
		}
		if (method === "thread/realtime/appendAudio") {
			if (!this.#voice) throw new ProtocolError(-32000, "Voice is not active");
			this.#voice.appendAudio(params.audio);
			return {};
		}
		if (method === "thread/settings/update") {
			for (const key of Object.keys(params))
				if (!["threadId", "effort", "model", "cwd", "summary"].includes(key) && params[key] != null)
					throw new ProtocolError(-32602, "Unsupported terminal settings override");
			if (params.model != null && params.model !== this.target.model?.id)
				throw new ProtocolError(-32602, "Unsupported model override; use the terminal's selected model");
			if (params.cwd != null && params.cwd !== this.target.sessionManager.getCwd())
				throw new ProtocolError(-32602, "Unsupported working directory override");
			if (params.summary != null && !["auto", "concise", "detailed", "none"].includes(String(params.summary)))
				throw new ProtocolError(-32602, "Unsupported reasoning summary");
			this.#applyEffort(params.effort);
			const effort = this.thread().reasoningEffort;
			this.#emit("thread/settings/updated", {
				threadSettings: {
					cwd: this.target.sessionManager.getCwd(),
					approvalPolicy: "never",
					approvalsReviewer: "user",
					sandboxPolicy: { type: "dangerFullAccess" },
					activePermissionProfile: null,
					model: this.target.model?.id ?? "",
					modelProvider: this.target.model?.provider ?? "",
					serviceTier: null,
					effort,
					summary: params.summary ?? null,
					collaborationMode: {
						mode: "default",
						settings: {
							model: this.target.model?.id ?? "",
							reasoning_effort: effort,
							developer_instructions: null,
						},
					},
					multiAgentMode: "explicitRequestOnly",
					personality: null,
				},
			});
			return {};
		}
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
		if (method === "thread/timeline/list") {
			if (!this.#durable) throw new ProtocolError(-32601, "Timeline requires persisted session history");
			const snapshot = projectHistorySnapshot(
				this.target.sessionId,
				this.target.sessionManager.getBranch(),
				Boolean(this.#active) || this.target.isStreaming,
			);
			this.#overlayLiveHistory(snapshot.turns);
			return timelinePage(this.target.sessionId, snapshot.timeline, params);
		}

		if (method === "thread/turns/list" || method === "thread/items/list") {
			const history = this.history();
			const threadId = this.target.sessionId;
			if (method === "thread/turns/list") {
				const view = historyItemsView(params.itemsView);
				const entries = history.map(value => ({ key: value.id, value: turnItemsView(value, view) }));
				return historyPage(entries, { threadId, collection: "turns", turnId: null }, params);
			}
			if (params.turnId != null && typeof params.turnId !== "string")
				throw new ProtocolError(-32602, "Invalid history turn filter");
			const turnId = (params.turnId as string | null | undefined) ?? null;
			const entries = history
				.filter(value => turnId === null || value.id === turnId)
				.flatMap(value => value.items.map(item => ({ key: String(item.id), value: { turnId: value.id, item } })));
			return historyPage(entries, { threadId, collection: "items", turnId }, params);
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
				turnsBackwardsCursor: historyCursor(
					{ threadId: this.target.sessionId, collection: "turns", turnId: null },
					history.at(-1)?.id,
				),
				itemsBackwardsCursor: historyCursor(
					{ threadId: this.target.sessionId, collection: "items", turnId: null },
					history.flatMap(value => value.items).at(-1)?.id as string | undefined,
				),
			};
		}
		if (method === "turn/interrupt") {
			if (!this.#active || params.turnId !== this.#active.id)
				throw new ProtocolError(-32602, "Active turn mismatch");
			await this.#effect(epoch, () => this.target.abort());
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
			const turnId = this.#active.id;
			const client =
				typeof params.clientUserMessageId === "string" ? { text, id: params.clientUserMessageId } : undefined;
			if (client) this.#pendingClients.push(client);
			try {
				await this.#effect(epoch, () => this.target.steer(text));
			} catch (error) {
				if (client) this.#pendingClients = this.#pendingClients.filter(value => value !== client);
				throw error;
			}
			return { turnId };
		}
		if (this.target.isStreaming || this.#active)
			throw new ProtocolError(-32000, "Session already running; use turn/steer");
		this.#applyEffort(params.effort);
		const active = this.#beginTurn();
		if (this.#durable) {
			try {
				await this.target.sessionManager.ensureOnDisk();
				this.#assertCurrent(epoch);
				await this.target.sessionManager.flush();
				this.#assertCurrent(epoch);
			} catch {
				if (epoch === this.#epoch) this.#active = undefined;
				throw new ProtocolError(-32000, "Could not persist the remote turn; task was not started");
			}
		}
		if (typeof params.clientUserMessageId === "string") this.#clientIds.set(active.id, params.clientUserMessageId);
		if (typeof params.clientUserMessageId === "string")
			this.#pendingClients.push({ text, id: params.clientUserMessageId });
		// The existing AgentSession remains the only executor and persistence owner.
		this.#emit("turn/started", { turn: active });
		void this.target.prompt(text).then(
			() => {
				if (epoch === this.#epoch) this.#finish("completed", active.id);
			},
			() => {
				if (epoch === this.#epoch) this.#finish("failed", active.id);
			},
		);
		return { turn: { ...active } };
	}
	#applyEffort(effort: unknown): void {
		if (effort == null) return;
		const supported = this.target.model?.thinking?.supportedLevels;
		if (
			!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(effort)) ||
			(supported && !supported.some(level => level.effort === effort))
		)
			throw new ProtocolError(-32602, "Selected model does not support that reasoning effort");
		try {
			this.target.setThinkingLevel((effort === "none" ? "off" : effort) as ThinkingLevel);
		} catch {
			throw new ProtocolError(-32602, "Selected model does not support that reasoning effort");
		}
	}
	#delegateVoice(id: string, text: string, output?: (update: VoiceOutputUpdate) => void): Promise<string> {
		return new Promise((resolve, reject) => {
			const current = this.#active;
			const turnId = current?.id ?? this.#nextTurnId();
			const stream = output ? { turnId, send: output } : undefined;
			if (stream) this.#voiceOutputs.add(stream);
			const cancel = () => {
				unsubscribe();
				this.#cancelDelegations.delete(cancel);
				if (stream) this.#voiceOutputs.delete(stream);
				reject(new Error("Backing session changed"));
			};
			this.#cancelDelegations.add(cancel);
			const unsubscribe = this.subscribe(event => {
				const result = event.params.turn as Turn | undefined;
				if (event.method !== "turn/completed" || result?.id !== turnId) return;
				unsubscribe();
				this.#cancelDelegations.delete(cancel);
				if (stream) this.#voiceOutputs.delete(stream);
				if (result.status === "failed") {
					reject(new Error("Backing turn failed"));
					return;
				}
				if (result.status === "interrupted") {
					resolve("The task was cancelled.");
					return;
				}
				resolve(
					result.items
						.filter(item => item.type === "agentMessage")
						.slice(-1)
						.map(item => String(item.text))
						.join("\n"),
				);
			});
			void this.call(`voice:${id}`, current ? "turn/steer" : "turn/start", {
				threadId: this.target.sessionId,
				...(current ? { expectedTurnId: current.id } : {}),
				clientUserMessageId: `voice:${id}`,
				input: [{ type: "text", text }],
			}).catch(error => {
				unsubscribe();
				this.#cancelDelegations.delete(cancel);
				if (stream) this.#voiceOutputs.delete(stream);
				reject(error);
			});
		});
	}
	#finish(status: string, expectedId?: string): void {
		if (this.#disposed || this.#boundId !== this.target.sessionId) return;
		if (!this.#active || (expectedId !== undefined && this.#active.id !== expectedId)) return;
		if (this.#durable) {
			const id = this.#active.id;
			const latest = this.history().find(value => value.id === id);
			if (status === "completed" && (latest?.status === "failed" || latest?.status === "interrupted"))
				status = latest.status;
			this.target.sessionManager.appendCustomEntry("remote-history", {
				kind: "turnCompleted",
				id,
				status,
				completedAtMs: Date.now(),
			});
			this.#active = undefined;
			this.#pendingClients = [];
			this.#emit("turn/completed", { turn: this.history().find(value => value.id === id) });
			return;
		}
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
		if (this.#disposed || this.#boundId !== this.target.sessionId) return;
		if (this.#durable) {
			this.#durableEvent(event);
			return;
		}
		if (event.type === "agent_start" && !this.#active) {
			this.#active = turn(`${this.target.sessionId}-turn-${this.history().length + 1}`, "inProgress");
			this.#emit("turn/started", { turn: this.#active });
		}
		if (event.type === "message_start" && event.message.role === "assistant") {
			this.#itemId = `${this.target.sessionId}-item-${this.target.messages.length}`;
			this.#emit("item/started", { turnId: this.#active?.id, item: this.#assistantItem(this.#itemId, "") });
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const update = event.assistantMessageEvent;
			const part = update.partial.content[update.contentIndex];
			if (part?.type === "text")
				this.#voiceOutput({
					id: `${this.#itemId}:${update.contentIndex}`,
					text: part.text,
					phase: part.phase,
					done: false,
				});
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			for (const [index, part] of event.message.content.entries())
				if (part.type === "text")
					this.#voiceOutput({ id: `${this.#itemId}:${index}`, text: part.text, phase: part.phase, done: true });
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
	#voiceOutput(update: VoiceOutputUpdate): void {
		let delegated = false;
		for (const stream of this.#voiceOutputs)
			if (stream.turnId === this.#active?.id) {
				delegated = true;
				stream.send(update);
			}
		if (!delegated && update.done) this.#voice?.mirrorText(update.text, update.phase);
	}
	#nextTurnId(): string {
		return this.#durable
			? `${this.target.sessionId}-turn-${this.#nextId}`
			: `${this.target.sessionId}-turn-${this.history().length + 1}`;
	}
	#beginTurn(): Turn {
		const active = turn(this.#nextTurnId(), "inProgress");
		this.#active = active;
		if (this.#durable) {
			this.#nextId = randomUUID();
			this.#startedAtMs = Date.now();
			active.startedAt = Math.floor(this.#startedAtMs / 1000);
			this.target.sessionManager.appendCustomEntry("remote-history", {
				kind: "turnStarted",
				id: active.id,
				startedAtMs: this.#startedAtMs,
			});
		}
		return active;
	}
	#rememberItem(item: Record<string, unknown>, done: boolean): void {
		if (!this.#active) return;
		const id = String(item.id);
		if (!this.#startedItems.has(id)) {
			this.#startedItems.add(id);
			this.#emit("item/started", {
				turnId: this.#active.id,
				item: item.type === "agentMessage" ? { ...item, text: "" } : { ...item },
			});
		}
		const index = this.#active.items.findIndex(value => value.id === id);
		if (index < 0) this.#active.items.push(item);
		else this.#active.items[index] = item;
		if (done) this.#emit("item/completed", { turnId: this.#active.id, item });
	}
	#durableEvent(event: AgentSessionEvent): void {
		if (event.type === "agent_start" && !this.#active) this.#emit("turn/started", { turn: this.#beginTurn() });
		if (event.type === "message_start" && (event.message.role === "user" || event.message.role === "assistant")) {
			const id = `${this.target.sessionId}-item-${randomUUID()}`;
			this.#messageIds.set(messageKey(event.message), id);
			if (event.message.role === "assistant") this.#itemId = id;
		}
		if (
			event.type === "message_update" &&
			(event.assistantMessageEvent.type === "text_delta" || event.assistantMessageEvent.type === "text_end")
		) {
			const update = event.assistantMessageEvent;
			const part = update.partial.content[update.contentIndex];
			if (part?.type === "text") {
				if (!this.#itemId) this.#itemId = `${this.target.sessionId}-item-${randomUUID()}`;
				const id = `${this.#itemId}:${update.contentIndex}`;
				this.#rememberItem(assistantHistoryItem(id, part.text, part.phase), false);
				if (update.type === "text_delta")
					this.#emit("item/agentMessage/delta", { turnId: this.#active?.id, itemId: id, delta: update.delta });
				this.#voiceOutput({ id, text: part.text, phase: part.phase, done: update.type === "text_end" });
			}
		}
		if (event.type === "message_end" && (event.message.role === "user" || event.message.role === "assistant")) {
			const message = event.message;
			const key = messageKey(message);
			const id =
				(message.role === "assistant" ? this.#itemId : this.#messageIds.get(key)) ||
				`${this.target.sessionId}-item-${randomUUID()}`;
			let clientId: string | null = null;
			if (message.role === "user") {
				const index = this.#pendingClients.findIndex(value => value.text === textOf(message));
				if (index >= 0) clientId = this.#pendingClients.splice(index, 1)[0].id;
			}
			const tools =
				message.role === "assistant"
					? {
							cwd: this.target.sessionManager.getCwd(),
							fileCallIds: message.content.flatMap(part =>
								part.type === "toolCall" &&
								getToolExecutionKind(this.target.getToolByName?.(part.name), part.arguments) === "fileChange"
									? [part.id]
									: [],
							),
							commandCallIds: message.content.flatMap(part =>
								part.type === "toolCall" &&
								getToolExecutionKind(this.target.getToolByName?.(part.name), part.arguments) === "command"
									? [part.id]
									: [],
							),
						}
					: undefined;
			this.target.sessionManager.appendCustomEntry("remote-history", { kind: "message", id, key, clientId, tools });
			this.#messageIds.delete(key);
			for (const item of messageHistoryItems(id, message, clientId, tools))
				this.#rememberItem(
					item,
					item.type !== "dynamicToolCall" && item.type !== "commandExecution" && item.type !== "fileChange",
				);
			if (message.role === "assistant") {
				for (const [index, part] of message.content.entries())
					if (part.type === "text")
						this.#voiceOutput({ id: `${id}:${index}`, text: part.text, phase: part.phase, done: true });
				this.#itemId = "";
			}
		}
		if (event.type === "async_job_settled" && !this.#commandSettlements.has(event.receiptId)) {
			const branch = this.target.sessionManager.getBranch();
			const receipt = branch.find(
				entry => entry.id === event.receiptId && entry.type === "custom" && entry.customType === "async-execution",
			);
			if (receipt) {
				const job = projectHistorySnapshot(this.target.sessionId, branch, Boolean(this.#active)).jobs.get(
					event.jobId,
				);
				if (job && job.item.status !== "inProgress") {
					this.#commandSettlements.add(event.receiptId);
					if (this.#commandSettlements.size > 128)
						this.#commandSettlements.delete(this.#commandSettlements.values().next().value!);
					this.#cacheCommandPreview(job.item);
					if (this.#active?.id === job.turnId) this.#rememberItem(job.item, true);
					else this.#emit("item/completed", { turnId: job.turnId, item: job.item });
				}
			}
		}

		if (event.type === "async_job_update" && typeof event.details?.outputDelta === "string") {
			const snapshot = projectHistorySnapshot(
				this.target.sessionId,
				this.target.sessionManager.getBranch(),
				Boolean(this.#active),
			);
			const job = snapshot.jobs.get(event.jobId);
			if (job?.item.status === "inProgress") {
				const updated = updateCommandHistoryItem(job.item, event.details.execution);
				if (updated && event.details.outputDelta) {
					updated.status = "inProgress";
					this.#forwardedBackgroundProgress.add(event.details);
					this.#cacheCommandPreview(updated);
					if (this.#active?.id === job.turnId) this.#rememberItem(updated, false);
					this.#emit("item/commandExecution/outputDelta", {
						turnId: job.turnId,
						itemId: updated.id,
						delta: event.details.outputDelta,
					});
				}
			}
		}
		if (event.type === "tool_execution_update") {
			const suffix = `:tool:${event.toolCallId}`;
			const item = this.#active?.items.findLast(
				value => value.type === "commandExecution" && String(value.id).endsWith(suffix),
			);
			const details = event.partialResult?.details;
			if (details && typeof details === "object" && this.#forwardedBackgroundProgress.has(details)) return;
			if (item?.status === "inProgress") {
				const updated = updateCommandHistoryItem(item, details?.execution);
				if (updated) {
					updated.status = "inProgress";
					this.#cacheCommandPreview(updated);
					this.#rememberItem(updated, false);
					if (typeof details?.outputDelta === "string" && details.outputDelta)
						this.#emit("item/commandExecution/outputDelta", {
							turnId: this.#active?.id,
							itemId: item.id,
							delta: details.outputDelta,
						});
				}
			}
		}
		if (event.type === "tool_execution_update") {
			const suffix = `:tool:${event.toolCallId}`;
			const item = this.#active?.items.findLast(
				value => value.type === "fileChange" && value.status === "inProgress" && String(value.id).endsWith(suffix),
			);
			const details = event.partialResult.details as { execution?: unknown } | undefined;
			const updated = item && updateFileHistoryItem(item, details?.execution);
			if (updated) {
				// Only the result message completes an item, even if a progress callback has final facts.
				updated.status = "inProgress";
				this.#rememberItem(updated, false);
				this.#emit("item/fileChange/patchUpdated", {
					turnId: this.#active?.id,
					itemId: updated.id,
					changes: updated.changes,
				});
			}
		}
		if (event.type === "message_end" && event.message.role === "toolResult") {
			const suffix = `:tool:${event.message.toolCallId}`;
			const item = this.#active?.items.findLast(
				value =>
					(value.type === "dynamicToolCall" || value.type === "commandExecution" || value.type === "fileChange") &&
					String(value.id).endsWith(suffix),
			);
			if (item) {
				const completed = completeToolHistoryItem(item, event.message);
				this.#rememberItem(completed, completed.status !== "inProgress");
			}
		}
		if (
			event.type === "message_end" &&
			event.message.role === "custom" &&
			event.message.customType === "async-result"
		) {
			const snapshot = projectHistorySnapshot(
				this.target.sessionId,
				this.target.sessionManager.getBranch(),
				Boolean(this.#active),
			);
			const completion = backgroundCommandCompletion(event.message, snapshot.jobs);
			if (completion) {
				this.#cacheCommandPreview(completion.item);
				if (this.#active?.id === completion.turnId) this.#rememberItem(completion.item, true);
				else this.#emit("item/completed", { turnId: completion.turnId, item: completion.item });
			}
		}
		if (event.type === "agent_end") {
			this.#finish("completed");
			this.#startedItems.clear();
			this.#messageIds.clear();
		}
	}
}
