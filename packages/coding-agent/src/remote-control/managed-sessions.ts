import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { VERSION } from "@f5-sales-demo/pi-utils";
import { createAgentSession } from "../sdk";
import { SessionManager } from "../session/session-manager";
import { projectHistory } from "./history";
import { connectPeer, type LocalPeer } from "./ipc";
import { inspectProcess, matchesProcessIdentity, type ProcessIdentity, signalVerifiedProcess } from "./lifecycle-state";
import type { RemoteThreadLifecycle, SessionEndpoint } from "./router";
import { type Notification, ProtocolError, RemoteSession } from "./session";

const CATALOG_VERSION = 1;
const DEFAULT_IDLE_MS = 30 * 60 * 1_000;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export interface ManagedThreadRecord {
	id: string;
	path: string | null;
	originalPath: string | null;
	cwd: string;
	archived: boolean;
	ephemeral: boolean;
	createdAt: number;
	updatedAt: number;
	model: string | null;
	modelProvider: string;
	reasoningEffort: string | null;
	name: string | null;
	forkedFromId: string | null;
	workerSocket: string | null;
	workerProcess: ProcessIdentity | null;
}

interface CatalogFile {
	version: 1;
	threads: ManagedThreadRecord[];
}

export interface ManagedRuntime {
	endpoint: SessionEndpoint;
	close: (terminate?: boolean) => Promise<void>;
	setPublisher?: (publish: (event: Notification) => void) => void;
	setClosed?: (listener: () => void) => void;
	workerSocket?: string;
	workerProcess?: ProcessIdentity;
}

export interface ManagedSessionRuntimeRequest {
	kind: "start" | "resume" | "fork";
	params: Record<string, unknown>;
	record?: ManagedThreadRecord;
	source?: ManagedThreadRecord;
}

export interface ManagedRemoteSessionsOptions {
	idleMs?: number;
	createRuntime?: (request: ManagedSessionRuntimeRequest) => Promise<ManagedRuntime>;
	workerCommand?: string[];
	workerEnv?: NodeJS.ProcessEnv;
	sessionsRoot?: string;
}

interface WorkerDescription {
	endpoint: Omit<SessionEndpoint, "call">;
	events: Array<{ seq: number; event: Notification }>;
	pid: number;
}

function pathWithin(root: string, candidate: string): boolean {
	if (!isAbsolute(candidate) || normalize(candidate) !== candidate) return false;
	const child = relative(root, candidate);
	return (
		child !== "" &&
		child !== ".." &&
		!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(child)
	);
}

function validProcessIdentity(value: ProcessIdentity | null | undefined): boolean {
	if (value == null) return true;
	return (
		Number.isSafeInteger(value.pid) &&
		value.pid > 0 &&
		typeof value.startTime === "string" &&
		value.startTime.length > 0 &&
		isAbsolute(value.executablePath) &&
		/^[a-f0-9]{64}$/.test(value.executableSha256) &&
		Number.isSafeInteger(value.generation) &&
		value.generation >= 0
	);
}

function sourceArguments(): string[] {
	return process.execPath.endsWith("bun") ? [process.argv[1]!] : [];
}

async function connectWorker(socketPath: string, attempts = 1): Promise<LocalPeer> {
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await connectPeer(socketPath);
		} catch (error) {
			lastError = error;
			if (attempt + 1 < attempts) await Bun.sleep(25);
		}
	}
	throw lastError;
}

async function waitForWorkerExit(record: ProcessIdentity, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	do {
		if (!matchesProcessIdentity(record, await inspectProcess(record.pid, record.generation))) return true;
		await Bun.sleep(25);
	} while (Date.now() < deadline);
	return !matchesProcessIdentity(record, await inspectProcess(record.pid, record.generation));
}

async function stopManagedWorker(
	socketPath: string,
	record: ProcessIdentity | null,
	connected?: LocalPeer,
): Promise<void> {
	let peer = connected;
	try {
		peer ??= await connectWorker(socketPath, 4);
		await peer.call("worker/stop", {}, 60_000);
	} catch {
		// A crashed or wedged worker falls through to exact-identity signalling.
	} finally {
		peer?.close();
	}
	if (!record || (await waitForWorkerExit(record, 1_000))) return;
	if (!(await signalVerifiedProcess(record, "SIGTERM"))) return;
	if (await waitForWorkerExit(record, 2_000)) return;
	if (!(await signalVerifiedProcess(record, "SIGKILL"))) return;
	if (!(await waitForWorkerExit(record, 2_000)))
		throw new Error("The identity-verified managed remote session worker did not stop");
}

async function createManagedWorkerRuntime(
	root: string,
	request: ManagedSessionRuntimeRequest,
	command = [process.execPath, ...sourceArguments()],
	env: NodeJS.ProcessEnv = process.env,
): Promise<ManagedRuntime> {
	let socketPath = request.record?.workerSocket ?? null;
	let workerProcess = request.record?.workerProcess ?? null;
	let peer: LocalPeer | undefined;
	let description: WorkerDescription | undefined;
	if (socketPath) {
		try {
			peer = await connectWorker(socketPath, 20);
			description = (await peer.call("worker/describe", {})) as WorkerDescription;
			const actual = await inspectProcess(description.pid, 0);
			if (!actual || (workerProcess && !matchesProcessIdentity(workerProcess, actual)))
				throw new Error("Managed worker identity mismatch");
			workerProcess = actual;
		} catch {
			peer?.close();
			peer = undefined;
		}
	}
	if (!peer || !description) {
		if (socketPath && workerProcess) await stopManagedWorker(socketPath, workerProcess);
		const workers = join(root, "workers");
		await mkdir(workers, { recursive: true, mode: 0o700 });
		socketPath = join(workers, `${randomUUID()}.sock`);
		const log = await open(join(root, "workers.log"), "a", 0o600);
		let child: ReturnType<typeof spawn>;
		try {
			await log.chmod(0o600);
			child = spawn(command[0]!, [...command.slice(1), "remote-control", "worker", socketPath], {
				detached: true,
				stdio: ["ignore", log.fd, log.fd],
				env,
			});
			child.unref();
		} finally {
			await log.close();
		}
		if (!child.pid) throw new Error("Unable to start managed remote session worker");
		try {
			peer = await connectWorker(socketPath, 400);
			description = (await peer.call("worker/initialize", { request }, 60_000)) as WorkerDescription;
			const identifiedWorker = await inspectProcess(description.pid, 0);
			if (!identifiedWorker) throw new Error("Unable to identify managed remote session worker");
			workerProcess = identifiedWorker;
		} catch (error) {
			peer?.close();
			child.kill("SIGTERM");
			throw error;
		}
	}
	if (!description.endpoint?.thread || typeof description.endpoint.thread.id !== "string") {
		peer.close();
		throw new Error("Managed worker returned an invalid endpoint");
	}
	let publish: (event: Notification) => void = () => {};
	let ready = false;
	let closed: () => void = () => {};
	const replay = [...description.events];
	const endpoint: SessionEndpoint = {
		...description.endpoint,
		call: async (identity, method, params) => {
			const response = (await peer!.call(
				"worker/sessionCall",
				{ identity, method, params },
				method === "turn/start" ? 24 * 60 * 60 * 1_000 : 60_000,
			)) as { result: unknown; endpoint?: Omit<SessionEndpoint, "call"> };
			if (response.endpoint) Object.assign(endpoint, response.endpoint);
			return response.result;
		},
	};
	peer.handle = async (method, params) => {
		if (method !== "worker/event" || typeof params.seq !== "number" || !params.event)
			throw new ProtocolError(-32602, "Invalid managed worker event");
		if (params.endpoint && typeof params.endpoint === "object")
			Object.assign(endpoint, params.endpoint as Record<string, unknown>);
		if (!ready) replay.push(params as unknown as { seq: number; event: Notification });
		else publish(params.event as Notification);
		return ready ? { ack: params.seq } : {};
	};
	peer.onClose = () => closed();
	return {
		endpoint,
		workerSocket: socketPath!,
		workerProcess: workerProcess!,
		setPublisher: listener => {
			publish = listener;
			ready = true;
			for (const queued of replay) publish(queued.event);
			const last = replay.at(-1)?.seq;
			replay.length = 0;
			if (last != null) void peer!.call("worker/ack", { seq: last }).catch(() => {});
		},
		setClosed: listener => {
			closed = listener;
		},
		close: async (terminate = true) => {
			if (terminate) await stopManagedWorker(socketPath!, workerProcess, peer);
			else peer!.close();
		},
	};
}

function thinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (value === "none") return "off";
	return ["minimal", "low", "medium", "high", "xhigh", "max"].includes(String(value))
		? (value as ThinkingLevel)
		: undefined;
}

function threadFromRecord(record: ManagedThreadRecord, turns: unknown[] = []): Record<string, unknown> {
	return {
		id: record.id,
		sessionId: record.id,
		forkedFromId: record.forkedFromId,
		parentThreadId: null,
		preview: "",
		ephemeral: record.ephemeral,
		section: null,
		sectionEnteredAt: null,
		projectId: null,
		historyMode: record.ephemeral ? "legacy" : "paginated",
		modelProvider: record.modelProvider,
		model: record.model,
		reasoningEffort: record.reasoningEffort,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		recencyAt: record.updatedAt,
		status: { type: "notLoaded" },
		path: record.path,
		cwd: record.cwd,
		cliVersion: VERSION,
		source: "appServer",
		threadSource: null,
		agentNickname: null,
		agentRole: null,
		gitInfo: null,
		name: record.name,
		turns,
		archived: record.archived,
	};
}

export async function createManagedSessionRuntime(request: ManagedSessionRuntimeRequest): Promise<ManagedRuntime> {
	const cwd = String(request.params.cwd ?? request.record?.cwd ?? request.source?.cwd ?? "");
	let sessionManager: SessionManager;
	if (request.kind === "resume") {
		if (!request.record?.path) throw new ProtocolError(-32602, "Persisted thread is unavailable");
		sessionManager = await SessionManager.open(request.record.path);
	} else if (request.kind === "fork") {
		if (!request.source?.path) throw new ProtocolError(-32602, "Fork source is unavailable");
		sessionManager =
			request.params.ephemeral === true
				? await SessionManager.inMemoryForkFrom(request.source.path, cwd)
				: await SessionManager.forkFrom(request.source.path, cwd);
	} else {
		sessionManager = request.params.ephemeral === true ? SessionManager.inMemory(cwd) : SessionManager.create(cwd);
	}
	const selector =
		typeof request.params.model === "string"
			? `${typeof request.params.modelProvider === "string" ? `${request.params.modelProvider}/` : ""}${request.params.model}`
			: undefined;
	const { session } = await createAgentSession({
		cwd,
		sessionManager,
		modelPattern: selector,
		thinkingLevel: thinkingLevel(request.params.effort),
		hasUI: true,
		profileDiscovery: true,
	});
	if (request.params.ephemeral !== true) {
		await session.sessionManager.ensureOnDisk();
		await session.sessionManager.flush();
	}
	const remote = new RemoteSession(session, VERSION, {
		getCollaborationMode: () => (session.getPlanModeState()?.enabled ? "plan" : "default"),
		setCollaborationMode: async mode => {
			session.setPlanModeState(
				mode === "plan"
					? { enabled: true, planFilePath: join(cwd, ".xcsh", "plans", `${session.sessionId}.md`) }
					: undefined,
			);
			session.sessionManager.appendModeChange(mode === "plan" ? "plan" : "none");
			await session.sessionManager.flush();
		},
		setModel: (model, effort) => session.setModelTemporary(model, effort),
	});
	const configure: Record<string, unknown> = { threadId: session.sessionId };
	for (const field of ["model", "effort", "serviceTier", "approvalPolicy", "approvalsReviewer", "multiAgentMode"])
		if (request.params[field] != null) configure[field] = request.params[field];
	if (request.params.sandbox != null) configure.sandboxPolicy = request.params.sandbox;
	if (request.params.collaborationMode != null) configure.collaborationMode = request.params.collaborationMode;
	if (Object.keys(configure).length > 1)
		await remote.call("managed-session-config", "thread/settings/update", configure);
	const catalog = remote.skills();
	const thread = () => ({
		...remote.thread(),
		forkedFromId: request.kind === "fork" ? (request.source?.id ?? null) : (request.record?.forkedFromId ?? null),
		source: "appServer",
	});
	let publish: (event: Notification) => void = () => {};
	const unsubscribe = remote.subscribe(event => publish(event));
	const endpoint: SessionEndpoint = {
		thread: thread(),
		models: remote.models(),
		skills: catalog.skills,
		skillErrors: catalog.errors,
		collaborationMode: session.getPlanModeState()?.enabled ? "plan" : "default",
		requests: remote.pendingRequests(),
		call: async (identity, method, params) => {
			const result = await remote.call(identity, method, params);
			endpoint.thread = thread();
			endpoint.requests = remote.pendingRequests();
			return result;
		},
	};
	return {
		endpoint,
		setPublisher: listener => {
			publish = listener;
		},
		close: async () => {
			unsubscribe();
			await remote.close();
			await session.dispose();
		},
	};
}

export class ManagedRemoteSessions implements RemoteThreadLifecycle {
	readonly defaultCwd: string;
	publish: (event: Notification) => void = () => {};
	detached: (threadId: string) => void = () => {};
	hasSubscribers: (threadId: string) => boolean = () => false;
	#records = new Map<string, ManagedThreadRecord>();
	#loaded = new Map<string, ManagedRuntime>();
	#loading = new Map<string, Promise<SessionEndpoint>>();
	#lastUsed = new Map<string, number>();
	#activated = new Set<string>();
	#pendingEvents = new Map<string, Notification[]>();
	#saveTail: Promise<void> = Promise.resolve();
	#timer?: ReturnType<typeof setInterval>;
	readonly #catalogPath: string;
	readonly #archiveDir: string;
	readonly #sessionsRoot: string;
	readonly #idleMs: number;
	readonly #createRuntime: (request: ManagedSessionRuntimeRequest) => Promise<ManagedRuntime>;

	constructor(
		private readonly root: string,
		defaultCwd: string,
		options: ManagedRemoteSessionsOptions = {},
	) {
		this.defaultCwd = defaultCwd;
		this.#catalogPath = join(root, "sessions.json");
		this.#archiveDir = join(root, "archived-sessions");
		this.#sessionsRoot = options.sessionsRoot ?? join(dirname(root), "sessions");
		this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
		this.#createRuntime =
			options.createRuntime ??
			(request => createManagedWorkerRuntime(root, request, options.workerCommand, options.workerEnv));
	}

	async initialize(): Promise<this> {
		try {
			const parsed = (await Bun.file(this.#catalogPath).json()) as CatalogFile;
			if (parsed.version !== CATALOG_VERSION || !Array.isArray(parsed.threads)) throw new Error();
			for (const record of parsed.threads) {
				this.#validateRecord(record);
				this.#records.set(record.id, record);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				const exists = await Bun.file(this.#catalogPath).exists();
				if (exists) throw new Error("Invalid remote session catalog");
			}
		}
		this.#timer = setInterval(() => void this.#unloadIdle(), Math.min(this.#idleMs, 60_000));
		this.#timer.unref?.();
		return this;
	}

	#validateRecord(record: ManagedThreadRecord): void {
		const validId = typeof record.id === "string" && record.id.length > 0 && record.id.length <= 256;
		const validCwd = isAbsolute(record.cwd) && normalize(record.cwd) === record.cwd;
		const expectedSuffix = validId ? `_${record.id}.jsonl` : "";
		const validOriginal =
			record.originalPath === null ||
			(pathWithin(this.#sessionsRoot, record.originalPath) &&
				basename(record.originalPath).endsWith(expectedSuffix));
		const validPath =
			record.path === null ||
			((record.archived ? pathWithin(this.#archiveDir, record.path) : pathWithin(this.#sessionsRoot, record.path)) &&
				basename(record.path).endsWith(expectedSuffix));
		const workers = join(this.root, "workers");
		const validWorker =
			record.workerSocket === null ||
			(pathWithin(workers, record.workerSocket) && basename(record.workerSocket).endsWith(".sock"));
		const validWorkerProcess =
			validProcessIdentity(record.workerProcess) && (record.workerSocket !== null || record.workerProcess == null);
		if (!validId || !validCwd || !validOriginal || !validPath || !validWorker || !validWorkerProcess)
			throw new Error("Invalid remote session catalog");
		record.workerProcess ??= null;
	}

	list(): Record<string, unknown>[] {
		return [...this.#records.values()].map(
			record => this.#loaded.get(record.id)?.endpoint.thread ?? threadFromRecord(record),
		);
	}

	async #writeCatalog(): Promise<void> {
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		const temp = `${this.#catalogPath}.${randomUUID()}`;
		const handle = await open(temp, "wx", 0o600);
		try {
			await handle.writeFile(
				JSON.stringify({
					version: CATALOG_VERSION,
					threads: [...this.#records.values()].filter(record => !record.ephemeral),
				}),
			);
		} finally {
			await handle.close();
		}
		await rename(temp, this.#catalogPath);
	}

	#save(): Promise<void> {
		const pending = this.#saveTail.then(() => this.#writeCatalog());
		this.#saveTail = pending.catch(() => {});
		return pending;
	}

	#record(
		endpoint: SessionEndpoint,
		params: Record<string, unknown>,
		forkedFromId: string | null,
	): ManagedThreadRecord {
		const thread = endpoint.thread;
		const now = Math.floor(Date.now() / 1000);
		return {
			id: String(thread.id),
			path: typeof thread.path === "string" ? thread.path : null,
			originalPath: typeof thread.path === "string" ? thread.path : null,
			cwd: String(thread.cwd ?? params.cwd),
			archived: false,
			ephemeral: thread.ephemeral === true,
			createdAt: typeof thread.createdAt === "number" ? thread.createdAt : now,
			updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : now,
			model: typeof thread.model === "string" ? thread.model : null,
			modelProvider: typeof thread.modelProvider === "string" ? thread.modelProvider : "unknown",
			reasoningEffort: typeof thread.reasoningEffort === "string" ? thread.reasoningEffort : null,
			name: typeof thread.name === "string" ? thread.name : null,
			forkedFromId,
			workerSocket: null,
			workerProcess: null,
		};
	}

	#attach(runtime: ManagedRuntime, params: Record<string, unknown>, forkedFromId: string | null): SessionEndpoint {
		const endpoint = runtime.endpoint;
		const id = String(endpoint.thread.id);
		const record = this.#record(endpoint, params, forkedFromId);
		record.workerSocket = runtime.workerSocket ?? this.#records.get(id)?.workerSocket ?? null;
		record.workerProcess = runtime.workerProcess ?? this.#records.get(id)?.workerProcess ?? null;
		this.#records.set(id, record);
		this.#loaded.set(id, runtime);
		this.#lastUsed.set(id, Date.now());
		runtime.setPublisher?.(event => {
			endpoint.thread = { ...endpoint.thread, updatedAt: Math.floor(Date.now() / 1000) };
			const current = this.#records.get(id);
			if (current)
				Object.assign(current, this.#record(endpoint, params, forkedFromId), {
					originalPath: current.originalPath,
					workerSocket: current.workerSocket,
					workerProcess: current.workerProcess,
				});
			this.#lastUsed.set(id, Date.now());
			if (!current?.ephemeral) void this.#save().catch(() => {});
			if (this.#activated.has(id)) this.publish(event);
			else {
				const pending = this.#pendingEvents.get(id) ?? [];
				pending.push(event);
				if (pending.length > 128) pending.shift();
				this.#pendingEvents.set(id, pending);
			}
		});
		runtime.setClosed?.(() => {
			if (this.#loaded.get(id) !== runtime) return;
			this.#loaded.delete(id);
			this.#lastUsed.delete(id);
			this.#activated.delete(id);
			this.#pendingEvents.delete(id);
			this.detached(id);
		});
		return endpoint;
	}

	activate(threadId: string): void {
		if (!this.#loaded.has(threadId) || this.#activated.has(threadId)) return;
		this.#activated.add(threadId);
		const pending = this.#pendingEvents.get(threadId) ?? [];
		this.#pendingEvents.delete(threadId);
		for (const event of pending) this.publish(event);
	}

	async start(params: Record<string, unknown>): Promise<SessionEndpoint> {
		const runtime = await this.#createRuntime({ kind: "start", params });
		const endpoint = this.#attach(runtime, params, null);
		if (endpoint.thread.ephemeral !== true) await this.#save();
		return endpoint;
	}

	async resume(threadId: string): Promise<SessionEndpoint | undefined> {
		const loaded = this.#loaded.get(threadId);
		if (loaded) {
			this.#lastUsed.set(threadId, Date.now());
			return loaded.endpoint;
		}
		const record = this.#records.get(threadId);
		if (!record || record.archived || record.ephemeral) return undefined;
		const existing = this.#loading.get(threadId);
		if (existing) return existing;
		const pending = (async () => {
			const runtime = await this.#createRuntime({ kind: "resume", params: { cwd: record.cwd }, record });
			const endpoint = this.#attach(runtime, { cwd: record.cwd }, record.forkedFromId);
			await this.#save();
			return endpoint;
		})().finally(() => this.#loading.delete(threadId));
		this.#loading.set(threadId, pending);
		return pending;
	}

	async read(threadId: string, params: Record<string, unknown>): Promise<unknown> {
		const loaded = this.#loaded.get(threadId);
		if (loaded) return loaded.endpoint.call(`read:${randomUUID()}`, "thread/read", params);
		const record = this.#records.get(threadId);
		if (!record?.path) throw new ProtocolError(-32602, "Thread not found");
		const manager = await SessionManager.open(record.path);
		const turns =
			params.includeTurns === true ? projectHistory(record.id, manager.getBranch(), false, record.cwd) : [];
		return { thread: threadFromRecord(record, turns) };
	}

	async fork(
		threadId: string,
		params: Record<string, unknown>,
		sourceThread?: Record<string, unknown>,
	): Promise<SessionEndpoint> {
		const source =
			this.#records.get(threadId) ??
			(sourceThread
				? this.#record({ thread: sourceThread, call: async () => ({}) }, sourceThread, null)
				: undefined);
		if (!source || source.archived || !source.path) throw new ProtocolError(-32602, "Thread not found");
		const runtime = await this.#createRuntime({ kind: "fork", params, source });
		const endpoint = this.#attach(runtime, params, threadId);
		if (endpoint.thread.ephemeral !== true) await this.#save();
		return endpoint;
	}

	async #unload(threadId: string): Promise<void> {
		const runtime = this.#loaded.get(threadId);
		if (!runtime) return;
		this.#loaded.delete(threadId);
		this.#lastUsed.delete(threadId);
		this.#activated.delete(threadId);
		this.#pendingEvents.delete(threadId);
		this.detached(threadId);
		await runtime.close(true);
		const record = this.#records.get(threadId);
		if (record) {
			record.workerSocket = null;
			record.workerProcess = null;
			if (!record.ephemeral) await this.#save();
		}
	}

	async #unloadIdle(): Promise<void> {
		const now = Date.now();
		for (const [id, runtime] of this.#loaded) {
			const status = runtime.endpoint.thread.status as { type?: unknown } | undefined;
			if (
				!this.hasSubscribers(id) &&
				status?.type !== "active" &&
				now - (this.#lastUsed.get(id) ?? now) >= this.#idleMs
			)
				await this.#unload(id);
		}
	}

	async archive(threadId: string): Promise<void> {
		const record = this.#records.get(threadId);
		if (!record || record.archived || record.ephemeral || !record.path)
			throw new ProtocolError(-32602, "Thread not found");
		await this.#unload(threadId);
		await mkdir(this.#archiveDir, { recursive: true, mode: 0o700 });
		const archivedPath = join(this.#archiveDir, basename(record.path));
		try {
			await stat(archivedPath);
			throw new ProtocolError(-32000, "Archive destination already exists");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await rename(record.path, archivedPath);
		const artifacts = record.path.slice(0, -6);
		if (await exists(artifacts)) await rename(artifacts, archivedPath.slice(0, -6));
		record.path = archivedPath;
		record.archived = true;
		record.updatedAt = Math.floor(Date.now() / 1000);
		await this.#save();
	}

	async unarchive(threadId: string): Promise<Record<string, unknown>> {
		const record = this.#records.get(threadId);
		if (!record?.archived || !record.path || !record.originalPath)
			throw new ProtocolError(-32602, "Archived thread not found");
		await mkdir(dirname(record.originalPath), { recursive: true, mode: 0o700 });
		await rename(record.path, record.originalPath);
		const artifacts = record.path.slice(0, -6);
		if (await exists(artifacts)) await rename(artifacts, record.originalPath.slice(0, -6));
		record.path = record.originalPath;
		record.archived = false;
		record.updatedAt = Math.floor(Date.now() / 1000);
		await this.#save();
		return threadFromRecord(record);
	}

	async delete(threadId: string): Promise<void> {
		const record = this.#records.get(threadId);
		if (!record) throw new ProtocolError(-32602, "Thread not found");
		await this.#unload(threadId);
		if (record.path) {
			await rm(record.path, { force: true });
			await rm(record.path.slice(0, -6), { recursive: true, force: true });
		}
		this.#records.delete(threadId);
		await this.#save();
	}

	async close(terminateDurable = false): Promise<void> {
		if (this.#timer) clearInterval(this.#timer);
		const loaded = new Set(this.#loaded.keys());
		const failures: unknown[] = [];
		await Promise.all(
			[...this.#loaded].map(async ([id, runtime]) => {
				const terminate = terminateDurable || this.#records.get(id)?.ephemeral === true;
				try {
					await runtime.close(terminate);
					if (terminate) {
						const record = this.#records.get(id);
						if (record) {
							record.workerSocket = null;
							record.workerProcess = null;
						}
					}
				} catch (error) {
					if (terminateDurable) failures.push(error);
				}
			}),
		);
		if (terminateDurable) {
			await Promise.all(
				[...this.#records].map(async ([id, record]) => {
					if (loaded.has(id) || !record.workerSocket) return;
					try {
						await stopManagedWorker(record.workerSocket, record.workerProcess);
						record.workerSocket = null;
						record.workerProcess = null;
					} catch (error) {
						failures.push(error);
					}
				}),
			);
		}
		this.#loaded.clear();
		this.#lastUsed.clear();
		this.#activated.clear();
		this.#pendingEvents.clear();
		if (terminateDurable) await this.#save();
		await this.#saveTail;
		if (failures.length > 0) throw new AggregateError(failures, "Unable to stop every managed remote session worker");
	}

	counts(): { total: number; loaded: number; archived: number } {
		return {
			total: [...this.#records.values()].filter(record => !record.archived).length,
			loaded: this.#loaded.size,
			archived: [...this.#records.values()].filter(record => record.archived).length,
		};
	}
}
