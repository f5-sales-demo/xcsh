import { expect, test, vi } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as ai from "@f5-sales-demo/pi-ai";
import Ajv from "ajv";
import { Settings } from "../../src/config/settings";
import { RemoteRouter } from "../../src/remote-control/router";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import replay from "./fixtures/iphone-folderless-manual-chat-sanitized.json";

const turnStartSchema = {
	type: "object",
	required: ["threadId", "input"],
	properties: {
		threadId: { type: "string" },
		clientUserMessageId: { type: ["string", "null"] },
		turnTrigger: { type: ["string", "null"] },
		cwd: { type: ["string", "null"] },
		model: { type: ["string", "null"] },
		effort: { type: ["string", "null"], minLength: 1 },
		summary: { enum: ["auto", "concise", "detailed", "none", null] },
		approvalPolicy: { enum: ["untrusted", "on-request", "never", null] },
		approvalsReviewer: { enum: ["user", "auto_review", "guardian_subagent", null] },
		sandboxPolicy: {
			anyOf: [
				{ type: "null" },
				{
					type: "object",
					required: ["type"],
					properties: { type: { enum: ["dangerFullAccess"] } },
					additionalProperties: false,
				},
			],
		},
		collaborationMode: { type: ["object", "null"] },
		input: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				required: ["type", "text"],
				properties: { type: { const: "text" }, text: { type: "string" } },
			},
		},
	},
} as const;

const processSpawnSchema = {
	type: "object",
	required: ["command", "cwd", "processHandle"],
	properties: {
		command: { type: "array", minItems: 1, items: { type: "string" } },
		processHandle: { type: "string" },
		cwd: { type: "string" },
		tty: { type: "boolean" },
		streamStdin: { type: "boolean" },
		streamStdoutStderr: { type: "boolean" },
		outputBytesCap: { type: ["integer", "null"], minimum: 0 },
		timeoutMs: { type: ["integer", "null"] },
	},
} as const;

test("sanitized manual-chat requests match pinned 0.153.4 and unchanged 0.154.0 shapes", () => {
	const ajv = new Ajv({ strict: false });
	const processRequest = replay.events.find(event => event.method === "process/spawn")!;
	const turnRequest = replay.events.find(event => event.method === "turn/start")!;
	const turnParams = turnRequest.params as Record<string, unknown>;
	const validateProcess = ajv.compile(processSpawnSchema);
	const validateTurn = ajv.compile(turnStartSchema);
	expect(validateProcess(processRequest.params), JSON.stringify(validateProcess.errors)).toBe(true);
	expect(validateTurn(turnParams), JSON.stringify(validateTurn.errors)).toBe(true);
	expect(
		Object.keys(turnParams)
			.filter(key => key !== "collaborationMode")
			.sort(),
	).toEqual(
		[...replay.schemaCompatibility["0.153.4"].turnStartFields].filter(key => Object.hasOwn(turnParams, key)).sort(),
	);
	expect(replay.schemaCompatibility["0.154.0"].relevantShapesIdentical).toBe(true);
});

test("zero-worker folderless manual chat completes, titles, and deduplicates the observed replay", async () => {
	const root = await mkdtemp(`${tmpdir()}/xcsh-folderless-manual-`);
	const notifications: Array<{ method: string; params: Record<string, any> }> = [];
	const settings = Settings.isolated({ "sandbox.enabled": true });
	const model = {
		id: "gpt-6-astra",
		provider: "openai-codex",
		api: "openai-responses",
		name: "Astra",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
		thinking: { supportedLevels: [{ effort: "high" }] },
	} as any;
	const models = [
		{
			id: model.id,
			provider: model.provider,
			displayName: "Astra",
			description: "Fixture model",
			supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
			defaultReasoningEffort: "high",
			inputModalities: ["text" as const],
		},
	];
	let sessionName: string | undefined;
	let listener: ((event: any) => void) | undefined;
	let promptCount = 0;
	let selectedMode = "default";
	let selectedEffort = "high";
	const messages: any[] = [];
	const manager = {
		getCwd: () => workspace,
		getSessionName: () => sessionName,
	};
	const target = {
		sessionId: "manual-chat",
		get sessionName() {
			return sessionName;
		},
		sessionFile: `${root}/manual-chat.jsonl`,
		model,
		messages,
		isStreaming: false,
		thinkingLevel: "high",
		settings,
		modelRegistry: { getAvailable: () => [model], getApiKey: async () => "fixture-key" },
		sessionManager: manager,
		subscribe: (next: (event: any) => void) => {
			listener = next;
			return () => {};
		},
		prompt: async (text: string) => {
			promptCount++;
			messages.push({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
			listener?.({ type: "agent_start" });
			const assistant = {
				role: "assistant",
				content: [{ type: "text", text: "Sunlight is scattered by the atmosphere, and blue light scatters most." }],
				usage: { input: 4, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 16 },
				stopReason: "stop",
				timestamp: 2,
			};
			messages.push(assistant);
			listener?.({ type: "message_start", message: assistant });
			listener?.({ type: "message_end", message: assistant });
			listener?.({ type: "agent_end", messages });
		},
		abort: async () => {},
		steer: async () => {},
		setThinkingLevel: (effort: string) => {
			selectedEffort = effort;
		},
		setSessionName: async (name: string) => {
			sessionName = name;
			return true;
		},
	} as unknown as SessionTarget;
	let workspace = root;
	const remote = new RemoteSession(target, "21.29.0", {
		getCollaborationMode: () => selectedMode as "default",
		setCollaborationMode: async mode => {
			selectedMode = mode;
		},
	});
	const endpoint = {
		thread: remote.thread(),
		models,
		call: (identity: string, method: string, params: Record<string, unknown>) =>
			remote.call(identity, method, params),
	};
	const coldThread = {
		...endpoint.thread,
		id: "cold-manual-chat",
		sessionId: "cold-manual-chat",
		cwd: root,
		model: model.id,
		modelProvider: model.provider,
		reasoningEffort: "high",
	};
	let startedWith: Record<string, unknown> | undefined;
	const lifecycle = {
		defaultCwd: root,
		list: () => (startedWith ? [endpoint.thread] : [coldThread]),
		start: async (params: Record<string, unknown>) => {
			startedWith = structuredClone(params);
			workspace = String(params.cwd);
			Object.assign(endpoint.thread, { cwd: workspace });
			return endpoint;
		},
		resume: async () => endpoint,
		read: async () => ({ thread: endpoint.thread }),
		fork: async () => endpoint,
		archive: async () => {},
		unarchive: async () => endpoint.thread,
		delete: async () => {},
	};
	const router = new RemoteRouter(root, "21.29.0", lifecycle);
	remote.subscribe(event => router.publish(event));
	router.notify = (_client, event) => notifications.push(event as any);
	const complete = vi.spyOn(ai, "completeSimple").mockResolvedValue({
		stopReason: "toolUse",
		content: [
			{
				type: "toolCall",
				id: "title",
				name: "submit_title",
				arguments: { title: "Why the Sky Is Blue" },
			},
		],
	} as never);
	const request = async (
		event: (typeof replay.events)[number],
		params: Record<string, unknown> = (event.params ?? {}) as Record<string, unknown>,
	) => {
		const response = (await router.handle("phone", { id: event.id, method: event.method, params })) as any;
		expect(response.error, `${event.method}: ${JSON.stringify(response.error)}`).toBeUndefined();
		return response.result;
	};
	try {
		await request(replay.events[0]!);
		const config = await request(replay.events[1]!);
		expect(config.config).toMatchObject({
			model: "gpt-6-astra",
			model_provider: "openai-codex",
			model_reasoning_effort: "high",
		});
		const modelList = await request(replay.events[2]!);
		expect(modelList.data).toMatchObject([{ id: "gpt-6-astra", isDefault: true }]);
		const modes = await request(replay.events[3]!);
		expect(modes.data.map((mode: any) => mode.mode)).toEqual(["plan", "default"]);

		const processEvent = replay.events.find(event => event.method === "process/spawn")!;
		const script = "sanitized bootstrap ".padEnd(processEvent.scriptBytes!, "x");
		expect(Buffer.byteLength(script)).toBe(911);
		await request(processEvent, {
			...(processEvent.params as Record<string, unknown>),
			command: ["/bin/sh", "-lc", script],
		});
		for (let attempt = 0; attempt < 200 && !notifications.some(event => event.method === "process/exited"); attempt++)
			await Bun.sleep(5);
		const exited = notifications.find(event => event.method === "process/exited");
		expect(exited?.params).toMatchObject({ exitCode: 0, stderr: "" });
		workspace = String(exited?.params.stdout);
		expect(await realpath(workspace)).toBe(`${await realpath(root)}/${workspace.slice(root.length + 1)}`);
		expect(workspace.startsWith(`${root}/`)).toBe(true);

		const threadEvent = replay.events.find(event => event.method === "thread/start")!;
		const started = await request(threadEvent, { cwd: workspace, model: "gpt-6-astra" });
		expect(started).toMatchObject({ model: "gpt-6-astra", modelProvider: "openai-codex" });
		expect(startedWith).toMatchObject({ cwd: workspace, model: "gpt-6-astra", modelProvider: "openai-codex" });

		const turnEvent = replay.events.find(event => event.id === "turn")!;
		const turnParams = structuredClone(turnEvent.params) as Record<string, any>;
		turnParams.threadId = endpoint.thread.id;
		turnParams.cwd = workspace;
		const first = await request(turnEvent, turnParams);
		for (
			let attempt = 0;
			attempt < 200 &&
			(!notifications.some(event => event.method === "turn/completed") ||
				!notifications.some(event => event.method === "thread/name/updated"));
			attempt++
		)
			await Bun.sleep(5);
		const assistant = notifications.find(
			event => event.method === "item/completed" && event.params.item?.type === "agentMessage",
		);
		expect(assistant?.params.item.text).toContain("blue light");
		expect(notifications.some(event => event.method === "turn/started")).toBe(true);
		expect(
			notifications.some(event => event.method === "turn/completed" && event.params.turn?.status === "completed"),
		).toBe(true);
		expect(notifications).toContainEqual(
			expect.objectContaining({
				method: "thread/name/updated",
				params: expect.objectContaining({ threadName: "Why the Sky Is Blue" }),
			}),
		);
		expect(endpoint.thread.name).toBe("Why the Sky Is Blue");
		expect(settings.get("sandbox.enabled")).toBe(false);
		expect(selectedMode).toBe("default");
		expect(selectedEffort).toBe("high");

		const retry = await router.handle("phone", {
			id: "turn-retry",
			method: "turn/start",
			params: turnParams,
		});
		expect(retry).toEqual({ id: "turn-retry", result: first });
		expect(promptCount).toBe(1);
		expect(notifications.filter(event => event.method === "turn/started")).toHaveLength(1);
		expect(notifications.filter(event => event.method === "turn/completed")).toHaveLength(1);
	} finally {
		complete.mockRestore();
		remote.dispose();
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
