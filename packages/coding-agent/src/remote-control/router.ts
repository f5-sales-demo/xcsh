import { isAbsolute, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadedThreadList, threadList } from "./discovery";
import { type InteractionRequest, validateInteractionRequests } from "./interactions";
import { collaborationModeResponse, configResponse, modelResponse } from "./metadata";
import { RemoteProcesses } from "./process";
import { type Notification, ProtocolError } from "./session";
import { voices } from "./voice-protocol";

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
export class RemoteRouter {
	sessions = new Map<string, SessionEndpoint>();
	notify: (client: string, event: Notification) => void = () => {};
	#processes = new RemoteProcesses(
		(client, event) => this.#emit(client, event),
		cwd => [...this.sessions.values()].some(session => session.thread.cwd === cwd),
	);
	dispose(): void {
		this.#processes.close();
		this.#clients.clear();
		this.#experimental.clear();
		this.#notificationOptOuts.clear();
		this.#delivered.clear();
	}
	#clients = new Map<string, Set<string>>();
	#experimental = new Set<string>();
	#notificationOptOuts = new Map<string, Set<string>>();
	#delivered = new Map<string, Map<string, string>>();
	constructor(
		private readonly home: string,
		private readonly version: string,
	) {}
	isInitialized(client: string): boolean {
		return this.#clients.has(client);
	}
	subscribed(client: string, threadId: string): boolean {
		return this.#clients.get(client)?.has(threadId) ?? false;
	}
	#emit(client: string, event: Notification): void {
		if (!this.#notificationOptOuts.get(client)?.has(event.method)) this.notify(client, event);
	}
	close(client: string): void {
		this.#clients.delete(client);
		this.#experimental.delete(client);
		this.#notificationOptOuts.delete(client);
		this.#delivered.delete(client);
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
	registerSession(threadId: string, endpoint: SessionEndpoint): void {
		const previous = this.sessions.get(threadId);
		const requests = this.validateSessionRequests(threadId, endpoint.requests ?? []);
		const nextIds = new Set(requests.map(request => request.id));
		for (const request of previous?.requests ?? []) {
			if (!nextIds.has(request.id))
				this.publish({ method: "serverRequest/resolved", params: { threadId, requestId: request.id } });
		}
		// Heartbeats retain the same live owner, including calls already awaiting a response.
		const current = previous ? Object.assign(previous, endpoint) : endpoint;
		this.sessions.set(threadId, current);
		for (const request of current.requests ?? [])
			for (const client of this.#clients.keys()) this.#deliver(client, request);
	}
	removeSession(threadId: string): void {
		if (!this.sessions.has(threadId)) return;
		for (const request of this.sessions.get(threadId)?.requests ?? [])
			this.publish({ method: "serverRequest/resolved", params: { threadId, requestId: request.id } });
		this.publish({ method: "thread/closed", params: { threadId } });
		this.sessions.delete(threadId);
		for (const subscriptions of this.#clients.values()) subscriptions.delete(threadId);
		for (const delivered of this.#delivered.values())
			for (const [id, thread] of delivered) if (thread === threadId) delivered.delete(id);
	}
	publish(event: Notification): void {
		const threadId = String(event.params.threadId);
		const session = this.sessions.get(threadId);
		if (!session) return;
		if (event.method === "thread/name/updated") {
			const name = event.params.threadName;
			if (name !== null && typeof name !== "string") return;
			session.thread.name = name;
			for (const client of this.#clients.keys()) this.#emit(client, event);
			return;
		}
		if (event.id !== undefined) {
			this.validateSessionRequests(threadId, [event]);
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
		for (const client of this.#clients.keys()) if (this.subscribed(client, threadId)) this.#emit(client, event);
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
			await session.call(JSON.stringify([client, "answer", response.id]), "session/interaction/respond", {
				threadId,
				requestId: response.id,
				response: response.result,
			});
		} catch {
			/* JSON-RPC responses have no response. Keep the question pending for a valid answer. */
		}
		return null;
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
						const page = threadList(
							[...this.sessions.values()].map(session => session.thread),
							params,
						);
						result = {
							...page,
							data: page.data.map(thread => threadWireView(thread, this.#experimental.has(client), null)),
						};
						break;
					}
					case "process/spawn":
					case "process/kill":
					case "process/writeStdin":
						result = await this.#processes.call(client, JSON.stringify(id), request.method, params);
						break;
					case "config/read": {
						const matching = [...this.sessions.values()].filter(session => session.thread.cwd === params.cwd);
						result = configResponse(
							matching.length === 1 ? matching[0].thread : undefined,
							params.includeLayers === true,
						);
						break;
					}
					case "thread/realtime/listVoices":
						result = { voices };
						break;
					case "model/list":
						if (params.cursor != null) throw new ProtocolError(-32602, "Unsupported model cursor");
						result = modelResponse([...this.sessions.values()].map(session => session.thread));
						break;
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
										...new Set([...this.sessions.values()].map(session => session.thread.cwd).filter(String)),
									] as string[]);
						result = {
							data: cwds.map(cwd => {
								const matches = [...this.sessions.values()].filter(session => session.thread.cwd === cwd);
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
						const owner = [...this.sessions.values()].find(session =>
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
						result = loadedThreadList([...this.sessions.keys()], params);
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
					case "thread/goal/get":
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
						const session = this.sessions.get(threadId);
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
