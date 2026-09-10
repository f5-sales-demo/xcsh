import { ProtocolError } from "./session";
export interface SessionEndpoint {
	thread: Record<string, unknown>;
	call: (identity: string, method: string, params: Record<string, unknown>) => Promise<unknown>;
}
export class RemoteRouter {
	sessions = new Map<string, SessionEndpoint>();
	#clients = new Map<string, Set<string>>();
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
	}
	async handle(client: string, input: unknown): Promise<unknown> {
		const request = input as { id?: string | number; method?: string; params?: Record<string, unknown> } | null;
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
				result = {
					userAgent: `xcsh/${this.version}`,
					codexHome: this.home,
					platformFamily: "unix",
					platformOs: process.platform,
				};
			} else {
				if (!this.#clients.has(client)) throw new ProtocolError(-32002, "Not initialized");
				switch (request.method) {
					case "thread/list": {
						const limit = params.limit ?? 100;
						if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100)
							throw new ProtocolError(-32602, "Invalid list limit");
						if (params.cursor != null) throw new ProtocolError(-32602, "Unsupported list cursor");
						let data: Record<string, unknown>[] = [...this.sessions.values()].map(session => ({
							...session.thread,
							turns: [],
						}));
						if (params.archived === true) data = [];
						if (typeof params.cwd === "string") data = data.filter(thread => thread.cwd === params.cwd);
						data.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
						result = { data: data.slice(0, limit as number), nextCursor: null };
						break;
					}
					case "threadSection/list":
						result = { data: [], nextCursor: null };
						break;
					case "thread/loaded/list":
						result = { data: [...this.sessions.keys()], nextCursor: null };
						break;
					case "thread/unsubscribe":
						this.#clients.get(client)?.delete(String(params.threadId));
						result = {};
						break;
					case "thread/turns/list":
					case "thread/items/list":
					case "thread/read":
					case "thread/resume":
					case "turn/start":
					case "turn/steer":
					case "turn/interrupt": {
						const threadId = String(params.threadId);
						const session = this.sessions.get(threadId);
						if (!session)
							throw new ProtocolError(
								-32602,
								"Thread not found; restart the terminal with the upgraded XCSH binary",
							);
						this.#clients.get(client)?.add(threadId);
						result = await session.call(JSON.stringify([client, id]), request.method, params);
						break;
					}
					default:
						throw new ProtocolError(-32601, "Unsupported XCSH remote method");
				}
			}
			return { id, result };
		} catch (error) {
			return {
				id,
				error: {
					code: error instanceof ProtocolError ? error.code : -32000,
					message: error instanceof ProtocolError ? error.message : "XCSH remote request failed",
				},
			};
		}
	}
}
