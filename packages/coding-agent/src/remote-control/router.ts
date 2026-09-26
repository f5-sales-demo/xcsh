import { mkdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { InteractionIdentity } from "../session/user-interactions";
import { PHONE_COMMAND_WRAPPER, RemoteCommandExec } from "./command-exec";
import { loadedThreadList, threadList } from "./discovery";
import { type InteractionRequest, validateInteractionRequests } from "./interactions";
import { collaborationModeResponse, configResponse, modelResponse } from "./metadata";
import { RemoteProcesses } from "./process";
import { type Notification, ProtocolError, type RemoteModelDescriptor } from "./session";
import { voices } from "./voice-protocol";

export interface AsyncInteractionRegistration {
	requestId: string;
	questionId: string;
	title?: string;
	options?: string[];
	identity: InteractionIdentity;
}

interface InitializeCapabilities {
	experimentalApi?: boolean;
	requestAttestation?: boolean;
	mcpServerOpenaiFormElicitation?: boolean;
	extensions?: Record<string, unknown> | null;
	optOutNotificationMethods?: string[] | null;
}

const threadWireFields = [
	"id",
	"sessionId",
	"forkedFromId",
	"parentThreadId",
	"preview",
	"ephemeral",
	"section",
	"sectionEnteredAt",
	"projectId",
	"historyMode",
	"modelProvider",
	"model",
	"reasoningEffort",
	"createdAt",
	"updatedAt",
	"recencyAt",
	"status",
	"path",
	"cwd",
	"cliVersion",
	"originator",
	"source",
	"threadSource",
	"agentNickname",
	"agentRole",
	"gitInfo",
	"name",
	"turns",
] as const;

/** Project an internal session descriptor onto the pinned App Server Thread wire type. */
function threadWireView(
	thread: Record<string, unknown>,
	experimental: boolean,
	canAcceptDirectInput: boolean | null,
): Record<string, unknown> {
	const wire: Record<string, unknown> = {};
	for (const field of threadWireFields) {
		if (field === "sessionId" && experimental) wire.extra = null;
		if (field === "originator") wire.originator = typeof thread.originator === "string" ? thread.originator : null;
		if (field === "threadSource" && experimental) wire.canAcceptDirectInput = canAcceptDirectInput;
		if (Object.hasOwn(thread, field)) wire[field] = thread[field];
	}
	return wire;
}

function projectThreadResult(result: unknown, experimental: boolean): unknown {
	if (!result || typeof result !== "object" || Array.isArray(result)) return result;
	const response = result as Record<string, unknown>;
	if (!response.thread || typeof response.thread !== "object" || Array.isArray(response.thread)) return result;
	return {
		...response,
		thread: threadWireView(response.thread as Record<string, unknown>, experimental, true),
	};
}

/** Recognize the phone's streamed blank-chat setup; its shell script is never executed. */
function isProjectlessWorkspaceSetup(params: Record<string, unknown>): boolean {
	const command = params.command;
	const env = params.env;
	const policy = params.sandboxPolicy;
	return (
		params.cwd === "/" &&
		Array.isArray(command) &&
		command.length === 7 &&
		command[0] === "/bin/sh" &&
		command[1] === "-c" &&
		command[2] === PHONE_COMMAND_WRAPPER &&
		typeof command[3] === "string" &&
		command[3].length <= 64 &&
		command[4] === "/bin/sh" &&
		command[5] === "-lc" &&
		typeof command[6] === "string" &&
		Buffer.byteLength(command[6]) <= 4096 &&
		typeof params.processId === "string" &&
		params.processId.length > 0 &&
		params.processId.length <= 256 &&
		params.streamStdoutStderr === true &&
		params.streamStdin !== true &&
		params.tty !== true &&
		params.size == null &&
		params.timeoutMs === 20_000 &&
		params.outputBytesCap === 4097 &&
		env != null &&
		typeof env === "object" &&
		!Array.isArray(env) &&
		Object.keys(env).every(key => ["BASH_ENV", "ENV", "CODEX_PROJECTLESS_ROOT"].includes(key)) &&
		(env as Record<string, unknown>).BASH_ENV === null &&
		(env as Record<string, unknown>).ENV === null &&
		typeof (env as Record<string, unknown>).CODEX_PROJECTLESS_ROOT === "string" &&
		((env as Record<string, unknown>).CODEX_PROJECTLESS_ROOT as string).length <= 4096 &&
		policy != null &&
		typeof policy === "object" &&
		!Array.isArray(policy) &&
		(policy as Record<string, unknown>).type === "workspaceWrite" &&
		(policy as Record<string, unknown>).networkAccess === true &&
		Array.isArray((policy as Record<string, unknown>).writableRoots) &&
		((policy as Record<string, unknown>).writableRoots as unknown[]).length === 1 &&
		typeof ((policy as Record<string, unknown>).writableRoots as unknown[])[0] === "string" &&
		(policy as Record<string, unknown>).excludeTmpdirEnvVar === false &&
		(policy as Record<string, unknown>).excludeSlashTmp === false
	);
}
function initializeCapabilities(value: unknown): InitializeCapabilities {
	if (value == null) return {};
	if (typeof value !== "object" || Array.isArray(value)) throw new ProtocolError(-32602, "Invalid capabilities");
	const capabilities = value as Record<string, unknown>;
	for (const field of ["experimentalApi", "requestAttestation", "mcpServerOpenaiFormElicitation"])
		if (capabilities[field] != null && typeof capabilities[field] !== "boolean")
			throw new ProtocolError(-32602, `Invalid ${field} capability`);
	const extensions = capabilities.extensions;
	if (extensions != null && (typeof extensions !== "object" || Array.isArray(extensions)))
		throw new ProtocolError(-32602, "Invalid extensions capability");
	const optOut = capabilities.optOutNotificationMethods;
	if (optOut != null && (!Array.isArray(optOut) || optOut.some(method => typeof method !== "string")))
		throw new ProtocolError(-32602, "Invalid notification opt-outs");
	return capabilities as InitializeCapabilities;
}
export interface SessionEndpoint {
	thread: Record<string, unknown>;
	collaborationMode?: "plan" | "default";
	publishedInteraction?: boolean;
	asyncInteractions?: AsyncInteractionRegistration[];
	models?: RemoteModelDescriptor[];
	requests?: InteractionRequest[];
	skills?: Array<{
		name: string;
		description: string;
		path: string;
		scope: "user" | "repo" | "system" | "admin";
		enabled: boolean;
		pluginId: string | null;
	}>;
	skillErrors?: Array<{ path: string; message: string }>;
	call: (identity: string, method: string, params: Record<string, unknown>) => Promise<unknown>;
}
export interface RemoteThreadLifecycle {
	defaultCwd?: string;
	activate?: (threadId: string) => void;
	list: (params?: Record<string, unknown>) => Record<string, unknown>[];
	start: (params: Record<string, unknown>) => Promise<SessionEndpoint>;
	resume: (threadId: string) => Promise<SessionEndpoint | undefined>;
	read: (threadId: string, params: Record<string, unknown>) => Promise<unknown>;
	fork: (
		threadId: string,
		params: Record<string, unknown>,
		source?: Record<string, unknown>,
	) => Promise<SessionEndpoint>;
	archive: (threadId: string) => Promise<void>;
	unarchive: (threadId: string) => Promise<Record<string, unknown>>;
	delete: (threadId: string) => Promise<void>;
	close?: () => void | Promise<void>;
}

const lifecycleResponseFields = [
	"thread",
	"model",
	"modelProvider",
	"serviceTier",
	"cwd",
	"runtimeWorkspaceRoots",
	"instructionSources",
	"approvalPolicy",
	"approvalsReviewer",
	"sandbox",
	"activePermissionProfile",
	"reasoningEffort",
	"multiAgentMode",
] as const;

function projectLifecycleResponse(result: unknown, experimental: boolean): unknown {
	if (!result || typeof result !== "object" || Array.isArray(result)) return result;
	const source = result as Record<string, unknown>;
	const projected: Record<string, unknown> = {};
	for (const field of lifecycleResponseFields) if (Object.hasOwn(source, field)) projected[field] = source[field];
	if (source.thread && typeof source.thread === "object" && !Array.isArray(source.thread))
		projected.thread = threadWireView(source.thread as Record<string, unknown>, experimental, true);
	return projected;
}
export class RemoteRouter {
	sessions = new Map<string, SessionEndpoint>();
	notify: (client: string, event: Notification) => void = () => {};
	#currentSessionId: string | undefined;
	#managed = new Set<string>();
	#publishedInteractions = new Set<string>();
	#currentSession(): SessionEndpoint | undefined {
		return (
			(this.#currentSessionId ? this.sessions.get(this.#currentSessionId) : undefined) ??
			[...this.sessions].find(([id]) => !this.#managed.has(id))?.[1]
		);
	}
	#visibleSessions(): SessionEndpoint[] {
		if (!this.#currentSessionId) {
			const terminals = [...this.sessions].flatMap(([id, session]) => (this.#managed.has(id) ? [] : [session]));
			return terminals.length ? terminals : [...this.sessions.values()];
		}
		const current = this.#currentSession();
		return [
			...(current ? [current] : []),
			...[...this.sessions].flatMap(([id, session]) =>
				this.#managed.has(id) && session !== current ? [session] : [],
			),
			...[...this.sessions].flatMap(([id, session]) =>
				this.#publishedInteractions.has(id) && !this.#managed.has(id) && session !== current ? [session] : [],
			),
		];
	}
	#visibleThreads(params?: Record<string, unknown>): Record<string, unknown>[] {
		const loaded = this.#visibleSessions().map(session => session.thread);
		const ids = new Set(loaded.map(thread => String(thread.id)));
		return [...loaded, ...(this.lifecycle?.list(params) ?? []).filter(thread => !ids.has(String(thread.id)))];
	}
	#isCurrent(threadId: string): boolean {
		return this.#currentSession()?.thread.id === threadId;
	}
	#isVisible(threadId: string): boolean {
		return this.#isCurrent(threadId) || this.#managed.has(threadId) || this.#publishedInteractions.has(threadId);
	}
	#isAsyncQuestionItem(event: Notification): boolean {
		if (event.method !== "item/started" && event.method !== "item/completed") return false;
		const item = event.params.item;
		return (
			!!item &&
			typeof item === "object" &&
			!Array.isArray(item) &&
			(item as Record<string, unknown>).type === "agentMessage" &&
			(item as Record<string, unknown>).delivery === "async" &&
			Array.isArray((item as Record<string, unknown>).questions)
		);
	}
	#interactionTitle(event: Notification): string | undefined {
		const questions =
			event.id !== undefined
				? event.params.questions
				: (event.params.item as { questions?: unknown } | undefined)?.questions;
		if (!Array.isArray(questions) || !questions.length) return;
		const question = questions[0];
		if (!question || typeof question !== "object" || Array.isArray(question)) return;
		const title = (question as Record<string, unknown>).title ?? (question as Record<string, unknown>).header;
		return typeof title === "string" && title.length > 0 && title.length <= 256 ? title : undefined;
	}
	#setInteractionTitle(session: SessionEndpoint, title: string | undefined): void {
		if ((session.thread.name === null || session.thread.name === undefined) && title) session.thread.name = title;
	}
	#asyncInteractionRequests(threadId: string, interactions: AsyncInteractionRegistration[]): InteractionRequest[] {
		const groups = new Map<string, AsyncInteractionRegistration[]>();
		for (const interaction of interactions) {
			if (interaction.identity.threadId !== threadId) continue;
			const entries = groups.get(interaction.identity.itemId) ?? [];
			entries.push(interaction);
			groups.set(interaction.identity.itemId, entries);
		}
		return [...groups.values()].flatMap(entries => {
			const first = entries[0];
			if (!first || entries.some(entry => entry.identity.turnId !== first.identity.turnId)) return [];
			return [
				{
					id: first.requestId,
					method: "item/tool/requestUserInput",
					params: {
						threadId,
						turnId: first.identity.turnId,
						itemId: first.identity.itemId,
						questions: entries.map(entry => ({
							id: entry.questionId,
							header: entry.title ?? "Question",
							question: entry.title ?? "Question",
							isOther: true,
							isSecret: false,
							options: entry.options?.map(label => ({ label, description: "" })) ?? null,
						})),
						isBlocking: false,
						autoResolutionMs: null,
					},
				},
			];
		});
	}
	#attachPublished(client: string, threadId: string, defer = false): void {
		if (!this.#experimental.has(client)) return;
		const subscriptions = this.#clients.get(client);
		const session = this.sessions.get(threadId);
		if (!subscriptions || !session || subscriptions.has(threadId)) return;
		subscriptions.add(threadId);
		const announce = () => {
			if (!this.subscribed(client, threadId) || this.sessions.get(threadId) !== session) return;
			this.#emit(client, {
				method: "thread/started",
				params: { thread: threadWireView(session.thread, true, true) },
			});
			for (const request of session.requests ?? []) this.#deliver(client, request);
		};
		if (defer) setTimeout(announce, 0);
		else announce();
	}
	#publishInteractionThread(threadId: string): void {
		if (this.#isCurrent(threadId) || this.#managed.has(threadId) || this.#publishedInteractions.has(threadId)) return;
		if (!this.sessions.has(threadId)) return;
		this.#publishedInteractions.add(threadId);
		for (const client of this.#clients.keys()) this.#attachPublished(client, threadId);
	}
	#processes = new RemoteProcesses(
		(client, event) => this.#emit(client, event),
		cwd => this.#visibleThreads().some(thread => thread.cwd === cwd),
	);
	#commands = new RemoteCommandExec((client, event) => this.#emit(client, event));
	dispose(): void {
		this.#commands.close();
		this.#processes.close();
		this.#clients.clear();
		this.#experimental.clear();
		this.#notificationOptOuts.clear();
		this.#delivered.clear();
		this.#lifecycleNotifications.clear();
		this.#publishedInteractions.clear();
	}
	#clients = new Map<string, Set<string>>();
	#experimental = new Set<string>();
	#notificationOptOuts = new Map<string, Set<string>>();
	#delivered = new Map<string, Map<string, string>>();
	#lifecycleNotifications = new Map<string, Map<string, string>>();
	constructor(
		private readonly home: string,
		private readonly version: string,
		private readonly lifecycle?: RemoteThreadLifecycle,
		private readonly preferredPrimaryId?: string,
	) {}
	isInitialized(client: string): boolean {
		return this.#clients.has(client);
	}
	subscribed(client: string, threadId: string): boolean {
		return this.#clients.get(client)?.has(threadId) ?? false;
	}
	hasSubscribers(threadId: string): boolean {
		return [...this.#clients.values()].some(threads => threads.has(threadId));
	}
	#emit(client: string, event: Notification, requiredInteractionLifecycle = false): void {
		if (!requiredInteractionLifecycle && this.#notificationOptOuts.get(client)?.has(event.method)) return;
		const threadId = String(event.params.threadId ?? "");
		const turn = event.params.turn as { id?: unknown } | undefined;
		const item = event.params.item as { id?: unknown } | undefined;
		const key =
			event.method === "thread/status/changed"
				? `${threadId}:status`
				: event.method === "thread/tokenUsage/updated"
					? `${threadId}:usage:${String(event.params.turnId ?? "")}`
					: event.method === "turn/started" || event.method === "turn/completed"
						? `${threadId}:${event.method}:${String(turn?.id ?? "")}`
						: event.method === "item/started" || event.method === "item/completed"
							? `${threadId}:${event.method}:${String(item?.id ?? "")}`
							: undefined;
		if (key) {
			let delivered = this.#lifecycleNotifications.get(client);
			if (!delivered) {
				delivered = new Map();
				this.#lifecycleNotifications.set(client, delivered);
			}
			const fingerprint = JSON.stringify(event.params);
			// Turn, item, and usage notifications are one-shot events identified by
			// their stable key. Provider recovery and worker replay can enrich their
			// payloads, but must not announce the same lifecycle transition twice.
			// Status is stateful, so retain fingerprint comparison to allow active
			// followed by idle while suppressing an exact repeated state.
			if (delivered.has(key) && (event.method !== "thread/status/changed" || delivered.get(key) === fingerprint))
				return;
			delivered.set(key, fingerprint);
		}
		this.notify(client, event);
	}
	replayThreadSettings(client: string, threadId: string, response: unknown): void {
		if (!this.subscribed(client, threadId) || !response || typeof response !== "object" || Array.isArray(response))
			return;
		const resumed = response as Record<string, unknown>;
		const session = this.sessions.get(threadId);
		const model = resumed.model;
		const modelProvider = resumed.modelProvider;
		const cwd = resumed.cwd;
		const effort = resumed.reasoningEffort;
		if (
			!session ||
			typeof model !== "string" ||
			typeof modelProvider !== "string" ||
			typeof cwd !== "string" ||
			(effort !== null && typeof effort !== "string") ||
			model !== session.thread.model ||
			modelProvider !== session.thread.modelProvider ||
			cwd !== session.thread.cwd ||
			effort !== session.thread.reasoningEffort
		)
			return;
		this.#emit(client, {
			method: "thread/settings/updated",
			params: {
				threadId,
				threadSettings: {
					cwd,
					approvalPolicy: resumed.approvalPolicy,
					approvalsReviewer: resumed.approvalsReviewer,
					sandboxPolicy: resumed.sandbox,
					activePermissionProfile: resumed.activePermissionProfile ?? null,
					model,
					modelProvider,
					serviceTier: resumed.serviceTier ?? null,
					effort,
					summary: null,
					collaborationMode: {
						mode: session.collaborationMode ?? "default",
						settings: { model, reasoning_effort: effort, developer_instructions: null },
					},
					multiAgentMode: "explicitRequestOnly",
					personality: null,
				},
			},
		});
	}
	close(client: string): void {
		this.#commands.close(client);
		this.#clients.delete(client);
		this.#experimental.delete(client);
		this.#notificationOptOuts.delete(client);
		this.#delivered.delete(client);
		this.#lifecycleNotifications.delete(client);
		this.#processes.close(client);
	}
	#deliver(client: string, event: InteractionRequest): void {
		const threadId = String(event.params.threadId);
		if (!this.#experimental.has(client) || !this.subscribed(client, threadId)) return;
		let delivered = this.#delivered.get(client);
		if (!delivered) {
			delivered = new Map();
			this.#delivered.set(client, delivered);
		}
		if (delivered.has(event.id)) return;
		delivered.set(event.id, threadId);
		this.#emit(client, event);
	}
	validateSessionRequests(threadId: string, input: unknown): InteractionRequest[] {
		const requests = validateInteractionRequests(threadId, input);
		const current = new Map(this.sessions.get(threadId)?.requests?.map(request => [request.id, request]));
		const otherIds = new Set<string>();
		for (const [ownerId, endpoint] of this.sessions)
			if (ownerId !== threadId) for (const request of endpoint.requests ?? []) otherIds.add(request.id);
		for (const request of requests) {
			const existing = current.get(request.id);
			if (otherIds.has(request.id) || (existing && !isDeepStrictEqual(existing, request)))
				throw new ProtocolError(-32602, "Pending request identity changed or belongs to another session");
		}
		return requests;
	}
	registerSession(threadId: string, endpoint: SessionEndpoint, replacedThreadId?: string): void {
		const previous = this.sessions.get(threadId);
		const requests = this.validateSessionRequests(threadId, [
			...(endpoint.requests ?? []),
			...this.#asyncInteractionRequests(threadId, endpoint.asyncInteractions ?? []),
		]);
		endpoint.requests = requests;
		const nextIds = new Set(requests.map(request => request.id));
		for (const request of previous?.requests ?? []) {
			if (!nextIds.has(request.id))
				this.publish({ method: "serverRequest/resolved", params: { threadId, requestId: request.id } });
		}
		// Heartbeats retain the same live owner, including calls already awaiting a response.
		const current = previous ? Object.assign(previous, endpoint) : endpoint;
		this.sessions.set(threadId, current);
		this.#setInteractionTitle(
			current,
			current.asyncInteractions?.find(interaction => interaction.title)?.title ??
				current.requests?.map(request => this.#interactionTitle(request)).find(title => title !== undefined),
		);
		if (
			(!this.#currentSessionId && this.#currentSession()?.thread.id === threadId) ||
			this.preferredPrimaryId === threadId
		)
			this.#currentSessionId = threadId;
		if (!previous && this.#isCurrent(threadId)) {
			for (const [client, subscriptions] of this.#clients) {
				if (replacedThreadId && subscriptions.has(replacedThreadId)) subscriptions.add(threadId);
				this.#emit(client, {
					method: "thread/started",
					params: { thread: threadWireView(current.thread, this.#experimental.has(client), true) },
				});
			}
		}
		if (
			current.publishedInteraction ||
			(current.requests?.length ?? 0) > 0 ||
			(current.asyncInteractions?.length ?? 0) > 0
		)
			this.#publishInteractionThread(threadId);
		for (const request of current.requests ?? [])
			for (const client of this.#clients.keys()) this.#deliver(client, request);
	}
	registerManagedSession(threadId: string, endpoint: SessionEndpoint): void {
		const previous = this.sessions.get(threadId);
		this.#managed.add(threadId);
		this.sessions.set(threadId, previous ? Object.assign(previous, endpoint) : endpoint);
	}
	removeSession(threadId: string): void {
		if (!this.sessions.has(threadId)) return;
		const wasCurrent = this.#isCurrent(threadId);
		const wasManaged = this.#managed.delete(threadId);
		const wasPublished = this.#publishedInteractions.has(threadId);
		for (const request of this.sessions.get(threadId)?.requests ?? [])
			this.publish({ method: "serverRequest/resolved", params: { threadId, requestId: request.id } });
		if (wasCurrent || wasPublished) this.publish({ method: "thread/closed", params: { threadId } });
		this.#publishedInteractions.delete(threadId);
		this.sessions.delete(threadId);
		if (wasCurrent) this.#currentSessionId = [...this.sessions.keys()].find(id => !this.#managed.has(id));
		for (const subscriptions of this.#clients.values()) subscriptions.delete(threadId);
		for (const delivered of this.#delivered.values())
			for (const [id, thread] of delivered) if (thread === threadId) delivered.delete(id);
		const next = this.#currentSession();
		if (wasCurrent && next)
			for (const client of this.#clients.keys())
				this.#emit(client, {
					method: "thread/started",
					params: { thread: threadWireView(next.thread, this.#experimental.has(client), true) },
				});
		if (wasManaged) return;
	}
	publish(event: Notification): void {
		const threadId = String(event.params.threadId);
		const session = this.sessions.get(threadId);
		if (!session) return;
		this.#setInteractionTitle(session, this.#interactionTitle(event));
		if (event.id !== undefined)
			try {
				this.validateSessionRequests(threadId, [event]);
			} catch (error) {
				if (!this.#isVisible(threadId)) return;
				throw error;
			}
		if (event.id !== undefined || this.#isAsyncQuestionItem(event)) this.#publishInteractionThread(threadId);
		if (!this.#isVisible(threadId)) return;
		if (event.method === "thread/name/updated") {
			const name = event.params.threadName;
			if (name !== null && typeof name !== "string") return;
			session.thread.name = name;
			for (const client of this.#clients.keys()) this.#emit(client, event);
			return;
		}
		if (event.method === "thread/status/changed") {
			const status = event.params.status;
			if (!status || typeof status !== "object" || Array.isArray(status)) return;
			session.thread.status = structuredClone(status);
			for (const client of this.#clients.keys()) if (this.subscribed(client, threadId)) this.#emit(client, event);
			return;
		}
		if (event.method === "thread/settings/updated") {
			const settings = event.params.threadSettings;
			if (settings && typeof settings === "object" && !Array.isArray(settings)) {
				const model = (settings as Record<string, unknown>).model;
				const provider = (settings as Record<string, unknown>).modelProvider;
				const effort = (settings as Record<string, unknown>).effort;
				const mode = ((settings as Record<string, unknown>).collaborationMode as { mode?: unknown } | undefined)
					?.mode;
				if (typeof model === "string") session.thread.model = model;
				if (typeof provider === "string") session.thread.modelProvider = provider;
				if (effort === null || typeof effort === "string") session.thread.reasoningEffort = effort;
				if (mode === "plan" || mode === "default") session.collaborationMode = mode;
				const descriptor = session.models?.find(item => item.id === model && item.provider === provider);
				if (descriptor) {
					session.thread.supportedReasoningEfforts = descriptor.supportedReasoningEfforts;
					session.thread.defaultReasoningEffort = descriptor.defaultReasoningEffort;
				}
			}
			for (const client of this.#clients.keys()) if (this.subscribed(client, threadId)) this.#emit(client, event);
			return;
		}
		if (event.id !== undefined) {
			const request = event as InteractionRequest;
			session.requests ??= [];
			const requests = session.requests;
			const existing = requests.find(value => value.id === event.id);
			if (!existing) {
				validateInteractionRequests(threadId, [...requests, event]);
				requests.push(structuredClone(request));
			}
			for (const client of this.#clients.keys()) this.#deliver(client, request);
			return;
		}
		if (event.method === "serverRequest/resolved") {
			const id = String(event.params.requestId);
			session.requests = session.requests?.filter(value => value.id !== id);
			for (const [client, delivered] of this.#delivered) {
				if (delivered.get(id) !== threadId) continue;
				delivered.delete(id);
				if (this.subscribed(client, threadId)) this.#emit(client, event);
			}
			return;
		}
		if (event.method === "item/completed" && this.#isAsyncQuestionItem(event)) {
			const item = event.params.item as Record<string, unknown>;
			const started: Notification = {
				method: "item/started",
				params: { ...event.params, item: { ...item, text: "" } },
			};
			for (const client of this.#clients.keys())
				if (this.subscribed(client, threadId)) {
					// A hidden owner can persist the item start before its bridge
					// registration publishes the thread. Reconstitute that transition
					// at the delivery boundary; #emit suppresses it when this client
					// already received the original start.
					this.#emit(client, started, true);
					this.#emit(client, event, true);
				}
			return;
		}
		for (const client of this.#clients.keys())
			if (this.subscribed(client, threadId)) this.#emit(client, event, this.#isAsyncQuestionItem(event));
	}
	async #response(
		client: string,
		response: { id?: string | number; result?: unknown; error?: unknown },
	): Promise<null> {
		if (typeof response.id !== "string" || response.error !== undefined || !Object.hasOwn(response, "result"))
			return null;
		const threadId = this.#delivered.get(client)?.get(response.id);
		if (!threadId || !this.subscribed(client, threadId) || !this.#experimental.has(client)) return null;
		const session = this.sessions.get(threadId);
		if (!session?.requests?.some(value => value.id === response.id)) return null;
		try {
			const result = await session.call(
				JSON.stringify([client, "answer", response.id]),
				"session/interaction/respond",
				{
					threadId,
					requestId: response.id,
					response: response.result,
				},
			);
			if ((result as { accepted?: unknown } | undefined)?.accepted === true)
				this.publish({ method: "serverRequest/resolved", params: { threadId, requestId: response.id } });
		} catch {
			/* JSON-RPC responses have no response. Keep the question pending for a valid answer. */
		}
		return null;
	}
	async #startCwd(params: Record<string, unknown>): Promise<string> {
		const candidate = params.cwd ?? this.#currentSession()?.thread.cwd ?? this.lifecycle?.defaultCwd;
		if (typeof candidate !== "string" || !isAbsolute(candidate) || normalize(candidate) !== candidate)
			throw new ProtocolError(-32602, "A normalized absolute working directory is required");
		try {
			if (!(await stat(candidate)).isDirectory()) throw new Error();
		} catch {
			throw new ProtocolError(-32602, "Working directory does not exist");
		}
		return candidate;
	}
	async #loadManagedSession(threadId: string): Promise<boolean> {
		if (this.sessions.has(threadId) || !this.lifecycle) return false;
		if (!this.#visibleThreads().some(thread => String(thread.id) === threadId)) return false;
		const endpoint = await this.lifecycle.resume(threadId);
		if (!endpoint) return false;
		const coldResume = !this.sessions.has(threadId);
		this.registerManagedSession(threadId, endpoint);
		return coldResume;
	}
	async #allocateBlankWorkspace(): Promise<string> {
		const root = this.lifecycle?.defaultCwd ?? this.#currentSession()?.thread.cwd;
		if (typeof root !== "string" || !isAbsolute(root) || normalize(root) !== root)
			throw new ProtocolError(-32602, "xcsh workspace root is unavailable");
		const now = new Date();
		const day = [
			now.getFullYear(),
			String(now.getMonth() + 1).padStart(2, "0"),
			String(now.getDate()).padStart(2, "0"),
		].join("-");
		const parent = join(root, day);
		await mkdir(parent, { recursive: true });
		for (let index = 1; index <= 10_000; index++) {
			const workspace = join(parent, `new-realtime-voice-chat-${index}`);
			try {
				await mkdir(workspace);
				return workspace;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST")
					throw new ProtocolError(-32000, "Unable to create xcsh workspace");
			}
		}
		throw new ProtocolError(-32000, "xcsh workspace limit reached");
	}
	async #processParams(
		method: string,
		params: Record<string, unknown>,
	): Promise<{ params: Record<string, unknown>; additionalAllowedCwd?: string }> {
		if (method !== "process/spawn" || params.cwd !== "/") return { params };
		let isolated = params;
		let additionalAllowedCwd: string | undefined;
		const command = params.command;
		if (
			Array.isArray(command) &&
			command.length === 3 &&
			command[0] === "/bin/sh" &&
			command[1] === "-lc" &&
			typeof command[2] === "string" &&
			params.timeoutMs === 20_000 &&
			params.outputBytesCap === 4096 &&
			params.tty === false &&
			params.streamStdin === false &&
			params.streamStdoutStderr === false
		) {
			const workspace = await this.#allocateBlankWorkspace();
			isolated = { ...params, cwd: workspace, command: ["/usr/bin/printf", "%s", workspace] };
			additionalAllowedCwd = workspace;
		}
		if (additionalAllowedCwd) return { params: isolated, additionalAllowedCwd };
		if (this.#visibleSessions().some(session => session.thread.cwd === "/")) return { params: isolated };
		// Blank-chat clients use root as a placeholder before choosing a workspace.
		// Map only that placeholder to the exposed primary. The phone's known blank-chat
		// bootstrap is also confined to xcsh's documents namespace instead of Codex's.
		const cwd = this.#currentSession()?.thread.cwd;
		return {
			params: typeof cwd === "string" && isAbsolute(cwd) && normalize(cwd) === cwd ? { ...isolated, cwd } : isolated,
		};
	}
	#defer(client: string, event: Notification): void {
		setTimeout(() => this.#emit(client, event), 0);
	}
	#deferThreadStarted(thread: Record<string, unknown>): void {
		for (const client of this.#clients.keys())
			this.#defer(client, {
				method: "thread/started",
				params: { thread: threadWireView(thread, this.#experimental.has(client), true) },
			});
	}
	async #lifecycleResponse(
		client: string,
		id: string | number,
		endpoint: SessionEndpoint,
		includeTurns: boolean,
	): Promise<{ result: unknown; thread: Record<string, unknown> }> {
		const threadId = String(endpoint.thread.id);
		this.registerManagedSession(threadId, endpoint);
		this.#clients.get(client)?.add(threadId);
		const resumed = await endpoint.call(JSON.stringify([client, id]), "thread/resume", {
			threadId,
			excludeTurns: !includeTurns,
		});
		// The resume call refreshes endpoint.thread. Snapshot it once so the response
		// and following notification cannot project different worker views.
		const experimental = this.#experimental.has(client);
		const thread = { ...endpoint.thread };
		const projected = projectLifecycleResponse(
			resumed && typeof resumed === "object" && !Array.isArray(resumed)
				? { ...(resumed as Record<string, unknown>), thread }
				: { thread },
			experimental,
		);
		const result = projected && typeof projected === "object" && !Array.isArray(projected) ? projected : { thread };
		return { result, thread };
	}
	#deferLifecycleActivation(threadId: string): void {
		setTimeout(() => this.lifecycle?.activate?.(threadId), 0);
	}
	async handle(client: string, input: unknown): Promise<unknown> {
		const request = input as {
			id?: string | number;
			method?: string;
			params?: Record<string, unknown>;
			result?: unknown;
			error?: unknown;
		} | null;
		if (
			request &&
			typeof request === "object" &&
			!Array.isArray(request) &&
			request.method === undefined &&
			(Object.hasOwn(request, "result") || Object.hasOwn(request, "error"))
		)
			return this.#response(client, request);
		const id = typeof request?.id === "string" || typeof request?.id === "number" ? request.id : null;
		try {
			if (!request || typeof request.method !== "string" || (request.id !== undefined && id === null))
				throw new ProtocolError(-32600, "Invalid request");
			if (request.params != null && (typeof request.params !== "object" || Array.isArray(request.params)))
				throw new ProtocolError(-32602, "Invalid parameters");
			const params = request.params ?? {};
			if (request.method === "initialized" && request.id === undefined) return null;
			if (request.id === undefined) return null;
			let result: unknown;
			if (request.method === "initialize") {
				const info = params.clientInfo as { name?: unknown; title?: unknown; version?: unknown } | undefined;
				if (!info || typeof info.name !== "string" || typeof info.version !== "string")
					throw new ProtocolError(-32602, "clientInfo required");
				if (info.title != null && typeof info.title !== "string")
					throw new ProtocolError(-32602, "Invalid clientInfo.title");
				const capabilities = initializeCapabilities(params.capabilities);
				const optOut = capabilities?.optOutNotificationMethods;
				if (this.#clients.has(client)) throw new ProtocolError(-32600, "Already initialized");
				if (this.#clients.size >= 64) throw new ProtocolError(-32000, "Remote client limit");
				this.#clients.set(client, new Set());
				this.#delivered.delete(client);
				this.#experimental.delete(client);
				this.#notificationOptOuts.set(client, new Set((optOut ?? []) as string[]));
				if (capabilities?.experimentalApi === true) this.#experimental.add(client);
				for (const threadId of this.#publishedInteractions) this.#attachPublished(client, threadId, true);
				result = {
					userAgent: `xcsh/${this.version}`,
					codexHome: this.home,
					platformFamily: "unix",
					platformOs: process.platform,
				};
			} else {
				if (!this.#clients.has(client)) throw new ProtocolError(-32002, "Not initialized");
				if (
					(request.method === "thread/timeline/list" || request.method === "collaborationMode/list") &&
					!this.#experimental.has(client)
				)
					throw new ProtocolError(-32600, `${request.method} requires experimentalApi capability`);
				switch (request.method) {
					case "thread/list": {
						if (!this.#experimental.has(client)) {
							for (const field of ["projectId", "parentThreadId", "ancestorThreadId"])
								if (field === "projectId" ? Object.hasOwn(params, field) : params[field] != null)
									throw new ProtocolError(-32600, `thread/list.${field} requires experimentalApi capability`);
						}
						const page = threadList(this.#visibleThreads(params), params);
						result = {
							...page,
							data: page.data.map(thread => threadWireView(thread, this.#experimental.has(client), null)),
						};
						break;
					}
					case "thread/start": {
						if (!this.lifecycle) throw new ProtocolError(-32000, "Managed remote sessions are unavailable");
						const cwd = await this.#startCwd(params);
						const requestedModel = typeof params.model === "string" ? params.model : undefined;
						const inferredProvider =
							typeof params.modelProvider === "string"
								? undefined
								: (this.#visibleSessions()
										.flatMap(session => session.models ?? [])
										.find(model => model.id === requestedModel)?.provider ??
									this.lifecycle
										?.list()
										.find(
											thread => thread.model === requestedModel && typeof thread.modelProvider === "string",
										)?.modelProvider);
						const startParams: Record<string, unknown> = {
							...params,
							cwd,
							...(inferredProvider ? { modelProvider: inferredProvider } : {}),
						};
						// Phone clients retain a selected model across host restarts, but the wire
						// protocol carries no provider. A model outside the current live catalog
						// cannot be resolved safely, so use the host's configured default.
						if (requestedModel && typeof params.modelProvider !== "string" && !inferredProvider)
							delete startParams.model;
						const endpoint = await this.lifecycle.start(startParams);
						const lifecycle = await this.#lifecycleResponse(client, id!, endpoint, false);
						result = lifecycle.result;
						this.#deferThreadStarted(lifecycle.thread);
						this.#deferLifecycleActivation(String(endpoint.thread.id));
						break;
					}
					case "thread/fork": {
						if (!this.lifecycle) throw new ProtocolError(-32000, "Managed remote sessions are unavailable");
						if (typeof params.threadId !== "string") throw new ProtocolError(-32602, "Thread not found");
						const source = this.#visibleThreads().find(thread => thread.id === params.threadId);
						if (!source) throw new ProtocolError(-32602, "Thread not found");
						const loadedSource = this.sessions.get(params.threadId);
						if (loadedSource)
							await loadedSource.call(JSON.stringify([client, id, "fork-flush"]), "xcsh/thread/flush", {});
						const cwd = params.cwd == null ? source.cwd : await this.#startCwd(params);
						if (typeof cwd !== "string") throw new ProtocolError(-32602, "Working directory is unavailable");
						const endpoint = await this.lifecycle.fork(params.threadId, { ...params, cwd }, source);
						const lifecycle = await this.#lifecycleResponse(client, id!, endpoint, params.excludeTurns !== true);
						result = lifecycle.result;
						this.#deferThreadStarted(lifecycle.thread);
						this.#deferLifecycleActivation(String(endpoint.thread.id));
						break;
					}
					case "thread/archive":
					case "thread/delete": {
						if (!this.lifecycle || typeof params.threadId !== "string")
							throw new ProtocolError(-32602, "Thread not found");
						const threadId = params.threadId;
						if (!this.#visibleThreads().some(thread => thread.id === threadId) || this.#isCurrent(threadId))
							throw new ProtocolError(-32602, "Thread not found");
						if (request.method === "thread/archive") await this.lifecycle.archive(threadId);
						else await this.lifecycle.delete(threadId);
						this.removeSession(threadId);
						for (const initialized of this.#clients.keys())
							this.#defer(initialized, {
								method: request.method === "thread/archive" ? "thread/archived" : "thread/deleted",
								params: { threadId },
							});
						result = {};
						break;
					}
					case "thread/unarchive": {
						if (!this.lifecycle || typeof params.threadId !== "string")
							throw new ProtocolError(-32602, "Thread not found");
						const thread = await this.lifecycle.unarchive(params.threadId);
						result = { thread: threadWireView(thread, this.#experimental.has(client), false) };
						for (const initialized of this.#clients.keys())
							this.#defer(initialized, { method: "thread/unarchived", params: { threadId: params.threadId } });
						break;
					}
					case "command/exec": {
						if (isProjectlessWorkspaceSetup(params)) {
							const workspace = await this.#allocateBlankWorkspace();
							this.#emit(client, {
								method: "command/exec/outputDelta",
								params: {
									processId: params.processId,
									stream: "stdout",
									deltaBase64: Buffer.from(`\0${workspace}`).toString("base64"),
									capReached: false,
								},
							});
							result = { exitCode: 0, stdout: "", stderr: "" };
							break;
						}
						const sandboxPolicy = params.sandboxPolicy;
						const policyType =
							sandboxPolicy && typeof sandboxPolicy === "object" && !Array.isArray(sandboxPolicy)
								? (sandboxPolicy as Record<string, unknown>).type
								: undefined;
						if (
							policyType === "readOnly" ||
							(policyType === "workspaceWrite" &&
								typeof params.processId === "string" &&
								params.streamStdoutStderr === true)
						) {
							if (policyType === "workspaceWrite" && params.cwd === "/")
								throw new ProtocolError(-32602, "Working directory is unavailable");
							const mapped = await this.#processParams("process/spawn", params);
							let cwd = mapped.params.cwd;
							if (
								cwd === "/" &&
								params.cwd === "/" &&
								!this.#visibleThreads().some(thread => thread.cwd === cwd)
							) {
								const fallback = this.lifecycle?.defaultCwd;
								if (typeof fallback !== "string" || !isAbsolute(fallback) || normalize(fallback) !== fallback)
									throw new ProtocolError(-32602, "Working directory is unavailable");
								try {
									if (!(await stat(fallback)).isDirectory()) throw new Error();
								} catch {
									throw new ProtocolError(-32602, "Working directory is unavailable");
								}
								cwd = fallback;
							}
							// A selected project can precede its first managed thread. The
							// read-only command sandbox, not thread visibility, confines execution.
							if (typeof cwd !== "string" || !isAbsolute(cwd) || normalize(cwd) !== cwd)
								throw new ProtocolError(-32602, "Working directory is unavailable");
							try {
								if (!(await stat(cwd)).isDirectory()) throw new Error();
								if (policyType === "workspaceWrite" && (await realpath(cwd)) !== cwd) throw new Error();
							} catch {
								throw new ProtocolError(-32602, "Working directory is unavailable");
							}
							result = await this.#commands.execute(client, { ...mapped.params, cwd }, cwd);
							break;
						}
						// The phone uses this standalone command to allocate a blank-chat
						// workspace. Reuse the existing host-owned allocator: the supplied
						// shell script is never executed, so its policy cannot widen access.
						if (
							params.cwd !== "/" ||
							params.processId != null ||
							params.streamStdoutStderr !== false ||
							!Array.isArray(params.command) ||
							typeof params.command[2] !== "string" ||
							!params.command[2].includes('target="$PWD/Documents/') ||
							!params.command[2].includes('mkdir -p "$target"') ||
							!params.command[2].includes('printf %s "$target"') ||
							(params.sandboxPolicy != null &&
								(typeof params.sandboxPolicy !== "object" ||
									Array.isArray(params.sandboxPolicy) ||
									!["dangerFullAccess", "workspaceWrite"].includes(
										String((params.sandboxPolicy as Record<string, unknown>).type),
									)))
						)
							throw new ProtocolError(-32602, "Unsupported standalone command");
						const bootstrap = await this.#processParams("process/spawn", {
							...params,
							tty: false,
							streamStdin: false,
						});
						if (!bootstrap.additionalAllowedCwd)
							throw new ProtocolError(-32602, "Unsupported standalone command");
						result = { exitCode: 0, stdout: bootstrap.additionalAllowedCwd, stderr: "" };
						break;
					}
					case "process/spawn":
					case "process/kill":
					case "process/writeStdin": {
						const processRequest = await this.#processParams(request.method, params);
						result = await this.#processes.call(
							client,
							JSON.stringify(id),
							request.method,
							processRequest.params,
							processRequest.additionalAllowedCwd,
						);
						break;
					}
					case "config/read": {
						const thread =
							params.cwd == null
								? // Global bootstrap config inherits model defaults from the exposed primary.
									(this.#currentSession()?.thread ?? this.lifecycle?.list()[0])
								: (() => {
										const matching = this.#visibleSessions().filter(
											session => session.thread.cwd === params.cwd,
										);
										return matching.length === 1 ? matching[0].thread : undefined;
									})();
						result = configResponse(thread, params.includeLayers === true);
						break;
					}
					case "thread/realtime/listVoices":
						result = { voices };
						break;
					case "model/list":
						if (params.cursor != null) throw new ProtocolError(-32602, "Unsupported model cursor");
						{
							const sessions = this.#visibleSessions();
							const catalog = sessions.flatMap(session => session.models ?? []);
							// Task settings opens before a phone-created worker attaches. Preserve a
							// managed thread's configured model in that zero-worker window so the
							// client receives a non-empty, selectable catalog.
							const threads =
								sessions.length > 0 ? sessions.map(session => session.thread) : (this.lifecycle?.list() ?? []);
							result = modelResponse(threads, catalog);
						}
						break;
					case "permissionProfile/list": {
						if (
							params.limit != null &&
							(!Number.isInteger(params.limit) ||
								(params.limit as number) < 0 ||
								(params.limit as number) > 0xffff_ffff)
						)
							throw new ProtocolError(-32602, "Invalid permission profile limit");
						if (params.cwd != null && typeof params.cwd !== "string")
							throw new ProtocolError(-32602, "Invalid permission profile working directory");
						if (params.cursor != null) {
							if (typeof params.cursor !== "string" || !/^\d+$/.test(params.cursor))
								throw new ProtocolError(-32602, "Invalid permission profile cursor");
							const cursor = Number(params.cursor);
							if (!Number.isSafeInteger(cursor) || cursor > 0)
								throw new ProtocolError(-32602, `Permission profile cursor ${params.cursor} exceeds catalog`);
						}
						// xcsh does not implement Codex permission profiles. Returning an empty
						// catalog is truthful and cannot mutate the running terminal sandbox.
						result = { data: [], nextCursor: null };
						break;
					}
					case "configRequirements/read":
						// xcsh has no Codex requirements.toml/MDM policy layer.
						result = { requirements: null };
						break;
					case "collaborationMode/list":
						result = collaborationModeResponse();
						break;
					case "skills/extraRoots/set":
						if (
							!Array.isArray(params.extraRoots) ||
							params.extraRoots.length > 128 ||
							params.extraRoots.some(
								root =>
									typeof root !== "string" ||
									root.length > 4096 ||
									!isAbsolute(root) ||
									normalize(root) !== root,
							)
						)
							throw new ProtocolError(-32602, "Skill roots must be normalized absolute paths");
						// Existing terminal sessions retain their loaded catalog. The roots are a
						// phone presentation hint and cannot change an already-running agent.
						for (const initialized of this.#clients.keys())
							this.#emit(initialized, { method: "skills/changed", params: {} });
						result = {};
						break;
					case "skills/list": {
						if (params.forceReload != null && typeof params.forceReload !== "boolean")
							throw new ProtocolError(-32602, "Invalid skill reload setting");
						const requested = params.cwds ?? [];
						if (
							!Array.isArray(requested) ||
							requested.length > 128 ||
							requested.some(cwd => typeof cwd !== "string" || cwd.length > 4096)
						)
							throw new ProtocolError(-32602, "Invalid skill working directories");
						const cwds =
							requested.length > 0
								? (requested as string[])
								: ([
										...new Set(
											this.#visibleSessions()
												.map(session => session.thread.cwd)
												.filter(String),
										),
									] as string[]);
						result = {
							data: cwds.map(cwd => {
								const matches = this.#visibleSessions().filter(session => session.thread.cwd === cwd);
								const skills = new Map<string, NonNullable<SessionEndpoint["skills"]>[number]>();
								const errors: Array<{ path: string; message: string }> = [];
								for (const session of matches) {
									for (const skill of session.skills ?? [])
										if (!skills.has(skill.path)) skills.set(skill.path, skill);
									errors.push(...(session.skillErrors ?? []));
								}
								if (matches.length === 0)
									errors.push({ path: cwd, message: "No live xcsh session for this directory" });
								return { cwd, skills: [...skills.values()], errors };
							}),
						};
						break;
					}
					case "fs/readFile": {
						if (
							typeof params.path !== "string" ||
							!isAbsolute(params.path) ||
							normalize(params.path) !== params.path
						)
							throw new ProtocolError(-32602, "File path must be absolute and normalized");
						const owner = this.#visibleSessions().find(session =>
							session.skills?.some(skill => skill.path === params.path),
						);
						if (!owner) throw new ProtocolError(-32602, "File is not an advertised live-session skill");
						result = await owner.call(JSON.stringify([client, "skill-read", id]), "session/skills/read", {
							threadId: owner.thread.id,
							path: params.path,
						});
						break;
					}
					case "plugin/installed":
						// The adapter exposes no Codex marketplace installations. xcsh tools remain
						// owned by the terminal; this is not a list of the terminal's loaded tools.
						result = { marketplaces: [], marketplaceLoadErrors: [] };
						break;
					case "threadSection/list":
						result = { data: [], nextCursor: null };
						break;
					case "thread/loaded/list":
						result = loadedThreadList(
							this.#visibleSessions().map(session => String(session.thread.id)),
							params,
						);
						break;
					case "thread/unsubscribe": {
						const threadId = String(params.threadId);
						const subscribed = this.#clients.get(client)?.delete(threadId);
						for (const [id, thread] of this.#delivered.get(client) ?? [])
							if (thread === threadId) this.#delivered.get(client)?.delete(id);
						result = {
							status: !this.sessions.has(threadId) ? "notLoaded" : subscribed ? "unsubscribed" : "notSubscribed",
						};
						break;
					}
					case "xcsh/interaction":
					case "thread/goal/get":
					case "thread/recap/read":
					case "thread/recap/generate":
					case "thread/queue/list":
					case "thread/turns/list":
					case "thread/items/list":
					case "thread/timeline/list":
					case "thread/read":
					case "thread/resume":
					case "thread/name/set":
					case "turn/start":
					case "turn/steer":
					case "thread/settings/update":
					case "thread/realtime/start":
					case "thread/realtime/stop":
					case "thread/realtime/appendText":
					case "thread/realtime/appendSpeech":
					case "thread/realtime/appendAudio":
					case "thread/compact/start":
					case "thread/revert":
					case "turn/interrupt": {
						if (
							(request.method === "thread/settings/update" || request.method === "turn/start") &&
							params.collaborationMode != null &&
							!this.#experimental.has(client)
						)
							throw new ProtocolError(
								-32600,
								`${request.method}.collaborationMode requires experimentalApi capability`,
							);
						const threadId = String(params.threadId);
						if (request.method === "thread/read" && !this.sessions.has(threadId) && this.lifecycle) {
							result = projectThreadResult(
								await this.lifecycle.read(threadId, params),
								this.#experimental.has(client),
							);
							break;
						}
						const coldResume = await this.#loadManagedSession(threadId);
						const session = this.#isVisible(threadId) ? this.sessions.get(threadId) : undefined;
						if (!session)
							throw new ProtocolError(
								-32602,
								"Thread not found; restart the terminal with the upgraded xcsh binary",
							);
						this.#clients.get(client)?.add(threadId);
						result = await session.call(JSON.stringify([client, id]), request.method, params);
						if (this.sessions.get(threadId) !== session)
							throw new ProtocolError(-32000, "Session attachment changed while processing request");
						if (request.method === "thread/read" || request.method === "thread/resume")
							result = projectThreadResult(result, this.#experimental.has(client));
						for (const event of session.requests ?? []) this.#deliver(client, event);
						if (coldResume) this.#deferLifecycleActivation(threadId);
						break;
					}
					default:
						throw new ProtocolError(-32601, "Unsupported xcsh remote method");
				}
			}
			return { id, result };
		} catch (error) {
			return {
				id,
				error: {
					code: error instanceof ProtocolError ? error.code : -32000,
					message: error instanceof ProtocolError ? error.message : "xcsh remote request failed",
				},
			};
		}
	}
}
