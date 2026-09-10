import { loadedThreadList, threadList } from "./discovery";
import type { InteractionRequest } from "./interactions";
import { configResponse, modelResponse } from "./metadata";
import { RemoteProcesses } from "./process";
import { type Notification, ProtocolError } from "./session";
import { voices } from "./voice-protocol";
export interface SessionEndpoint {
	thread: Record<string, unknown>;
	requests?: InteractionRequest[];
	call: (identity: string, method: string, params: Record<string, unknown>) => Promise<unknown>;
}
export class RemoteRouter {
	sessions = new Map<string, SessionEndpoint>();
	notify: (client: string, event: Notification) => void = () => {};
	#processes = new RemoteProcesses(
		(client, event) => this.notify(client, event),
		cwd => [...this.sessions.values()].some(session => session.thread.cwd === cwd),
	);
	dispose(): void {
		this.#processes.close();
		this.#clients.clear();
		this.#experimental.clear();
		this.#delivered.clear();
	}
	#clients = new Map<string, Set<string>>();
	#experimental = new Set<string>();
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
	close(client: string): void {
		this.#clients.delete(client);
		this.#experimental.delete(client);
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
		this.notify(client, event);
	}
	publish(event: Notification): void {
		const threadId = String(event.params.threadId);
		const session = this.sessions.get(threadId);
		if (!session) return;
		if (event.id !== undefined) {
			if (event.method !== "item/tool/requestUserInput") return;
			const request = event as InteractionRequest;
			session.requests ??= [];
			const requests = session.requests;
			if (!requests.some(value => value.id === event.id)) {
				if (requests.length >= 32) return;
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
				if (this.subscribed(client, threadId)) this.notify(client, event);
			}
			return;
		}
		for (const client of this.#clients.keys()) if (this.subscribed(client, threadId)) this.notify(client, event);
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
				const info = params.clientInfo as { name?: unknown; version?: unknown } | undefined;
				if (!info || typeof info.name !== "string" || typeof info.version !== "string")
					throw new ProtocolError(-32602, "clientInfo required");
				if (!this.#clients.has(client) && this.#clients.size >= 64)
					throw new ProtocolError(-32000, "Remote client limit");
				this.#clients.set(client, new Set());
				this.#delivered.delete(client);
				this.#experimental.delete(client);
				if ((params.capabilities as { experimentalApi?: unknown } | undefined)?.experimentalApi === true)
					this.#experimental.add(client);
				result = {
					userAgent: `xcsh/${this.version}`,
					codexHome: this.home,
					platformFamily: "unix",
					platformOs: process.platform,
				};
			} else {
				if (!this.#clients.has(client)) throw new ProtocolError(-32002, "Not initialized");
				if (request.method === "thread/timeline/list" && !this.#experimental.has(client))
					throw new ProtocolError(-32600, "thread/timeline/list requires experimentalApi capability");
				switch (request.method) {
					case "thread/list": {
						if (!this.#experimental.has(client)) {
							for (const field of ["projectId", "parentThreadId", "ancestorThreadId"])
								if (field === "projectId" ? Object.hasOwn(params, field) : params[field] != null)
									throw new ProtocolError(-32600, `thread/list.${field} requires experimentalApi capability`);
						}
						result = threadList(
							[...this.sessions.values()].map(session => session.thread),
							params,
						);
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
						// No Codex collaboration presets are exposed by this existing-session adapter.
						result = { data: [] };
						break;
					case "skills/extraRoots/set":
						if (!Array.isArray(params.extraRoots) || params.extraRoots.length !== 0)
							throw new ProtocolError(
								-32602,
								"Remote skill roots are not supported; manage skills in the terminal",
							);
						result = {};
						break;
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
					case "turn/start":
					case "turn/steer":
					case "thread/settings/update":
					case "thread/realtime/start":
					case "thread/realtime/stop":
					case "thread/realtime/appendText":
					case "thread/realtime/appendSpeech":
					case "thread/realtime/appendAudio":
					case "turn/interrupt": {
						const threadId = String(params.threadId);
						const session = this.sessions.get(threadId);
						if (!session)
							throw new ProtocolError(
								-32602,
								"Thread not found; restart the terminal with the upgraded xcsh binary",
							);
						this.#clients.get(client)?.add(threadId);
						result = await session.call(JSON.stringify([client, id]), request.method, params);
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
