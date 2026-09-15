import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "../../src/config/settings";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";

function fixture(
	id: string,
	controls: {
		getCollaborationMode?: () => "plan" | "default";
		setCollaborationMode?: (mode: "plan" | "default") => Promise<void>;
		setModel?: (model: any, thinkingLevel: any) => Promise<void>;
	} = {},
) {
	const prompts: string[] = [];
	let finish = () => {};
	let sessionName = id;
	const settings = Settings.isolated({ "sandbox.enabled": false });
	const target = {
		sessionId: id,
		get sessionName() {
			return sessionName;
		},
		sessionFile: `/tmp/${id}.jsonl`,
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		messages: [],
		isStreaming: false,
		settings,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
		prompt: async (text: string) => {
			prompts.push(text);
			await new Promise<void>(resolve => {
				finish = resolve;
			});
		},
		abort: async () => {
			finish();
		},
		steer: async (text: string) => {
			prompts.push(text);
		},
		setSessionName: async (name: string) => {
			sessionName = name.trim();
			return true;
		},
	} as unknown as SessionTarget;
	return { remote: new RemoteSession(target, "21.22.0", controls), prompts, finish: () => finish(), settings };
}

test("phone rename follows the pinned trim, response and notification contract", async () => {
	const a = fixture("a");
	const events: any[] = [];
	a.remote.subscribe(event => events.push(event));
	expect(await a.remote.call("rename", "thread/name/set", { threadId: "a", name: "  xcsh Remote New  " })).toEqual({});
	expect(a.remote.thread().name).toBe("xcsh Remote New");
	expect(events).toEqual([
		{ method: "thread/name/updated", params: { threadId: "a", threadName: "xcsh Remote New" } },
	]);
	await expect(
		a.remote.call("empty-rename", "thread/name/set", { threadId: "a", name: " \n\t " }),
	).rejects.toMatchObject({ code: -32602 });
	a.remote.dispose();
});
test("two sessions preserve identity/model and route prompts to their existing owner exactly once", async () => {
	const a = fixture("a");
	const b = fixture("b");
	expect(a.remote.thread().model).toBe("gpt-6-astra");
	const params = { threadId: "a", input: [{ type: "text", text: "remember alpha" }] };
	const first = await a.remote.call("request-a", "turn/start", params);
	expect(await a.remote.call("request-a", "turn/start", params)).toEqual(first);
	expect(a.prompts).toEqual(["remember alpha"]);
	expect(b.prompts).toEqual([]);
	await expect(b.remote.call("request-b", "turn/start", params)).rejects.toThrow("Thread not found");
	a.finish();
	a.remote.dispose();
	b.remote.dispose();
});
test("rejects unsupported input/model overrides before running anything", async () => {
	const a = fixture("a");
	await expect(
		a.remote.call("r1", "turn/start", { threadId: "a", model: "other", input: [{ type: "text", text: "test" }] }),
	).rejects.toThrow("Unsupported");
	await expect(
		a.remote.call("r2", "turn/start", { threadId: "a", input: [{ type: "image", url: "fixture" }] }),
	).rejects.toThrow("Unsupported");
	expect(a.prompts).toEqual([]);
	a.remote.dispose();
});
test("unsupported methods return explicit protocol errors", async () => {
	const a = fixture("a");
	await expect(a.remote.call("r", "thread/delete", { threadId: "a" })).rejects.toMatchObject({ code: -32601 });
	a.remote.dispose();
});

test("manual compaction starts asynchronously and revert selects the exact pre-turn branch", async () => {
	const a = fixture("a");
	let release = () => {};
	let compactCalls = 0;
	let navigated = "";
	const ordering: string[] = [];
	a.remote.subscribe(event => {
		if (event.method === "thread/reverted") ordering.push("notification");
	});
	const entries = [
		{
			type: "message",
			id: "user-one",
			parentId: null,
			timestamp: "2026-09-14T00:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "one" }], timestamp: 1 },
		},
		{
			type: "message",
			id: "assistant-one",
			parentId: "user-one",
			timestamp: "2026-09-14T00:00:01.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				stopReason: "stop",
				timestamp: 2,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
			},
		},
		{
			type: "message",
			id: "user-two",
			parentId: "assistant-one",
			timestamp: "2026-09-14T00:00:02.000Z",
			message: { role: "user", content: [{ type: "text", text: "two" }], timestamp: 3 },
		},
	] as any[];
	Object.assign(a.remote.target.sessionManager, { getBranch: () => entries, flush: async () => {} });
	Object.assign(a.remote.target, {
		compact: async () => {
			compactCalls++;
			await new Promise<void>(resolve => {
				release = resolve;
			});
		},
		navigateTree: async (entryId: string) => {
			navigated = entryId;
			return { cancelled: false };
		},
	});
	expect(await a.remote.call("compact", "thread/compact/start", { threadId: "a" })).toEqual({});
	expect(compactCalls).toBe(1);
	const reverted = (await a.remote.call("revert", "thread/revert", {
		threadId: "a",
		beforeTurnId: "a-turn-user-two",
	})) as any;
	ordering.push("response");
	expect(navigated).toBe("user-two");
	expect(reverted.thread).toMatchObject({ id: "a", turns: [] });
	expect(reverted).toHaveProperty("turnsBackwardsCursor");
	expect(ordering).toEqual(["response"]);
	await Bun.sleep(1);
	expect(ordering).toEqual(["response", "notification"]);
	release();
	a.remote.dispose();
});

test("live skill metadata and reads stay bound to the terminal's loaded skill files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-remote-skill-"));
	const skillPath = join(dir, "SKILL.md");
	const otherPath = join(dir, "other.md");
	const largePath = join(dir, "large.md");
	await writeFile(skillPath, "---\nname: fixture\ndescription: Fixture\n---\n\n# Fixture\n");
	await writeFile(otherPath, "private");
	await writeFile(largePath, Buffer.alloc(1024 * 1024 + 1));
	const target = {
		...fixture("skills").remote.target,
		skills: [
			{
				name: "fixture",
				description: "Fixture",
				filePath: skillPath,
				baseDir: dir,
				source: "agents:project",
				_source: { provider: "agents", providerName: "Agents", path: skillPath, level: "project" },
			},
			{
				name: "large",
				description: "Large",
				filePath: largePath,
				baseDir: dir,
				source: "agents:user",
				_source: { provider: "agents", providerName: "Agents", path: largePath, level: "user" },
			},
		],
		skillWarnings: [{ skillPath: dir, message: "fixture warning" }],
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	try {
		expect(remote.skills()).toEqual({
			skills: [
				{
					name: "fixture",
					description: "Fixture",
					path: skillPath,
					scope: "repo",
					enabled: true,
					pluginId: null,
				},
				{
					name: "large",
					description: "Large",
					path: largePath,
					scope: "user",
					enabled: true,
					pluginId: null,
				},
			],
			errors: [{ path: dir, message: "fixture warning" }],
		});
		expect(await remote.call("read", "session/skills/read", { threadId: "skills", path: skillPath })).toEqual({
			dataBase64: Buffer.from(await Bun.file(skillPath).arrayBuffer()).toString("base64"),
		});
		await expect(
			remote.call("other", "session/skills/read", { threadId: "skills", path: otherPath }),
		).rejects.toMatchObject({
			code: -32602,
		});
		await expect(
			remote.call("relative", "session/skills/read", { threadId: "skills", path: "SKILL.md" }),
		).rejects.toMatchObject({
			code: -32602,
		});
		await expect(
			remote.call("large", "session/skills/read", { threadId: "skills", path: largePath }),
		).rejects.toMatchObject({
			code: -32602,
		});
	} finally {
		remote.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});

test("phone can resume metadata and then hydrate paginated turns", async () => {
	const a = fixture("a");
	const resumed = await a.remote.call("resume", "thread/resume", { threadId: "a", excludeTurns: true });
	expect(resumed).toMatchObject({ thread: { id: "a", turns: [] } });
	expect(
		await a.remote.call("page", "thread/turns/list", {
			threadId: "a",
			limit: 20,
			sortDirection: "desc",
			itemsView: "full",
		}),
	).toEqual({ data: [], nextCursor: null, backwardsCursor: null });
	a.remote.dispose();
});

test("phone experimental initial page rejoins live TUI while retaining its configuration", async () => {
	const a = fixture("a");
	const response = await a.remote.call("resume-page", "thread/resume", {
		threadId: "a",
		excludeTurns: true,
		initialTurnsPage: { limit: 20, sortDirection: "desc", itemsView: "summary" },
		cwd: "/other",
		config: { model: "different", model_reasoning_effort: "low" },
	});
	expect(response).toMatchObject({
		model: "gpt-6-astra",
		cwd: "/tmp",
		initialTurnsPage: { data: [], nextCursor: null, backwardsCursor: null },
		runtimeWorkspaceRoots: ["/tmp"],
		activePermissionProfile: null,
		multiAgentMode: "explicitRequestOnly",
	});
	expect(a.prompts).toEqual([]);
	a.remote.dispose();
});

test("phone reads the actual live queue and absence of a Codex autonomous goal", async () => {
	const a = fixture("a");
	a.remote.target.getQueuedMessages = () => ({ steering: ["steer fixture"], followUp: ["next fixture"] });
	expect(await a.remote.call("goal", "thread/goal/get", { threadId: "a" })).toEqual({ goal: null });
	const queue = await a.remote.call("queue", "thread/queue/list", { threadId: "a", limit: 20 });
	expect(queue).toMatchObject({
		data: [{ input: [{ type: "text", text: "steer fixture" }] }, { input: [{ type: "text", text: "next fixture" }] }],
		nextCursor: null,
	});
	a.remote.target.getQueuedMessages = () => ({ steering: [], followUp: [] });
	expect(await a.remote.call("queue2", "thread/queue/list", { threadId: "a" })).toEqual({
		data: [],
		nextCursor: null,
	});
	a.remote.dispose();
});

test("phone turn metadata preserves the work model and deduplicates client message retries", async () => {
	const a = fixture("a");
	const efforts: unknown[] = [];
	a.remote.target.setThinkingLevel = effort => {
		efforts.push(effort);
	};
	const p = {
		threadId: "a",
		clientUserMessageId: "fixture-user-message",
		model: "gpt-6-astra",
		cwd: "/tmp",
		effort: "high",
		summary: "auto",
		turnTrigger: "user",
		input: [{ type: "text", text: "fixture prompt" }],
	};
	const result = await a.remote.call("phone-1", "turn/start", p);
	expect(await a.remote.call("phone-2", "turn/start", p)).toEqual(result);
	expect(a.prompts).toEqual(["fixture prompt"]);
	expect(efforts).toEqual(["high"]);
	expect(a.remote.target.model?.id).toBe("gpt-6-astra");
	await expect(
		a.remote.call("phone-3", "turn/start", { ...p, input: [{ type: "text", text: "different" }] }),
	).rejects.toThrow("identity");
	a.finish();
	a.remote.dispose();
});

test("provider failure becomes a failed remote turn and a readable history error", async () => {
	let listener: (event: any) => void = () => {};
	const messages: any[] = [];
	const target = {
		sessionId: "fixture",
		messages,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: (fn: any) => {
			listener = fn;
			return () => {};
		},
		prompt: async () => {
			messages.push(
				{ role: "user", content: "fixture" },
				{ role: "assistant", content: [], stopReason: "error", errorMessage: "private backend detail" },
			);
			listener({ type: "agent_end" });
		},
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	const events: any[] = [];
	remote.subscribe(event => events.push(event));
	await remote.call("fixture", "turn/start", { threadId: "fixture", input: [{ type: "text", text: "fixture" }] });
	await Bun.sleep(0);
	expect(events.find(e => e.method === "turn/completed")?.params.turn).toMatchObject({
		status: "failed",
		error: { message: "The selected model could not complete this turn. Check the terminal for details." },
	});
	expect(remote.history()[0]).toMatchObject({
		status: "failed",
		error: { message: "The selected model could not complete this turn. Check the terminal for details." },
	});
	expect(JSON.stringify(events)).not.toContain("private backend detail");
	remote.dispose();
});

test("phone settings update applies effort and truthful Ask or Full permission profiles", async () => {
	const a = fixture("a");
	const levels: unknown[] = [],
		events: any[] = [];
	a.remote.target.setThinkingLevel = level => {
		levels.push(level);
	};
	a.remote.subscribe(event => events.push(event));
	expect(await a.remote.call("settings", "thread/settings/update", { threadId: "a", effort: "medium" })).toEqual({});
	expect(levels).toEqual(["medium"]);
	expect(a.prompts).toEqual([]);
	expect(events).toContainEqual(expect.objectContaining({ method: "thread/settings/updated" }));
	expect(
		await a.remote.call("settings-policy", "thread/settings/update", {
			threadId: "a",
			approvalPolicy: "never",
			approvalsReviewer: "user",
			sandboxPolicy: { type: "dangerFullAccess" },
		}),
	).toEqual({});
	expect(
		await a.remote.call("settings-policy-ask", "thread/settings/update", {
			threadId: "a",
			approvalPolicy: "on-request",
			approvalsReviewer: "user",
			sandboxPolicy: {
				type: "workspaceWrite",
				writableRoots: [],
				networkAccess: false,
				excludeTmpdirEnvVar: false,
				excludeSlashTmp: false,
			},
		}),
	).toEqual({});
	expect(a.settings.get("sandbox.enabled")).toBe(true);
	expect(events.at(-1)).toMatchObject({
		method: "thread/settings/updated",
		params: {
			threadSettings: {
				approvalPolicy: "on-request",
				approvalsReviewer: "user",
				sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
				activePermissionProfile: { id: ":workspace" },
			},
		},
	});
	expect(await a.remote.call("resume-ask", "thread/resume", { threadId: "a", excludeTurns: true })).toMatchObject({
		approvalPolicy: "on-request",
		approvalsReviewer: "user",
		sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
		activePermissionProfile: { id: ":workspace" },
	});
	expect(
		await a.remote.call("settings-policy-full-again", "thread/settings/update", {
			threadId: "a",
			approvalPolicy: "never",
			approvalsReviewer: "user",
			sandboxPolicy: { type: "dangerFullAccess" },
		}),
	).toEqual({});
	expect(a.settings.get("sandbox.enabled")).toBe(false);
	await expect(
		a.remote.call("settings2", "thread/settings/update", { threadId: "a", model: "different", effort: "high" }),
	).rejects.toMatchObject({ code: -32602 });
	expect(levels).toEqual(["medium"]);
	expect(a.remote.target.model?.id).toBe("gpt-6-astra");
	a.remote.dispose();
});

test("phone model and effort buttons apply one exact session selection and publish the resulting state", async () => {
	const levels = [
		{ effort: "low", description: "Low" },
		{ effort: "high", description: "High" },
	];
	const selected: Array<{ id: string; effort: string }> = [];
	const a = fixture("a", {
		setModel: async (model, thinkingLevel) => {
			selected.push({ id: model.id, effort: thinkingLevel });
			(a.remote.target as any).model = model;
			(a.remote.target as any).thinkingLevel = thinkingLevel;
		},
	});
	(a.remote.target as any).modelRegistry = {
		getAvailable: () => [
			(a.remote.target as any).model,
			{
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				description: "Deep reasoning",
				provider: "openai-codex",
				input: ["text", "image"],
				thinking: { supportedLevels: levels, defaultLevel: "high" },
			},
		],
	};
	const events: any[] = [];
	a.remote.subscribe(event => events.push(event));

	expect(
		await a.remote.call("model", "thread/settings/update", {
			threadId: "a",
			model: "gpt-5.6-sol",
			effort: "high",
			serviceTier: null,
		}),
	).toEqual({});
	expect(selected).toEqual([{ id: "gpt-5.6-sol", effort: "high" }]);
	expect(a.remote.thread()).toMatchObject({
		model: "gpt-5.6-sol",
		modelProvider: "openai-codex",
		reasoningEffort: "high",
		supportedReasoningEfforts: levels.map(level => ({
			reasoningEffort: level.effort,
			description: level.description,
		})),
	});
	expect(events.at(-1)).toMatchObject({
		method: "thread/settings/updated",
		params: { threadSettings: { model: "gpt-5.6-sol", effort: "high" } },
	});
	a.remote.dispose();
});

test("phone model changes validate the target effort before changing session state", async () => {
	let changed = false;
	const a = fixture("a", {
		setModel: async () => {
			changed = true;
		},
	});
	(a.remote.target as any).modelRegistry = {
		getAvailable: () => [
			(a.remote.target as any).model,
			{
				id: "gpt-5.6-luna",
				provider: "openai-codex",
				thinking: {
					supportedLevels: [{ effort: "low", description: "Low" }],
					defaultLevel: "low",
				},
			},
			{ id: "gpt-5.4", provider: "openai-codex" },
		],
	};

	await expect(
		a.remote.call("bad-effort", "thread/settings/update", {
			threadId: "a",
			model: "gpt-5.6-luna",
			effort: "high",
		}),
	).rejects.toMatchObject({ code: -32602 });
	await expect(
		a.remote.call("missing-model", "thread/settings/update", {
			threadId: "a",
			model: "gpt-missing",
			effort: "low",
		}),
	).rejects.toMatchObject({ code: -32602 });
	await expect(
		a.remote.call("historical-model", "thread/settings/update", {
			threadId: "a",
			model: "gpt-5.4",
		}),
	).rejects.toMatchObject({ code: -32602 });
	await expect(
		a.remote.call("unsupported-multi-agent", "thread/settings/update", {
			threadId: "a",
			multiAgentMode: "autonomous",
		}),
	).rejects.toMatchObject({ code: -32602 });
	expect(changed).toBe(false);
	expect(a.remote.thread().model).toBe("gpt-6-astra");
	a.remote.dispose();
});

test("phone model changes cannot race an active turn", async () => {
	let changed = false;
	const a = fixture("a", {
		setModel: async () => {
			changed = true;
		},
	});
	(a.remote.target as any).modelRegistry = {
		getAvailable: () => [(a.remote.target as any).model, { id: "gpt-5.6-sol", provider: "openai-codex" }],
	};
	await a.remote.call("turn", "turn/start", {
		threadId: "a",
		input: [{ type: "text", text: "keep running" }],
	});
	await expect(
		a.remote.call("model-during-turn", "thread/settings/update", {
			threadId: "a",
			model: "gpt-5.6-sol",
		}),
	).rejects.toMatchObject({ code: -32000 });
	expect(changed).toBe(false);
	expect(a.remote.thread().model).toBe("gpt-6-astra");
	a.finish();
	a.remote.dispose();
});

test("an immediate prompt waits for the phone model tap to finish", async () => {
	const release = Promise.withResolvers<void>();
	const a = fixture("a", {
		setModel: async (model, thinkingLevel) => {
			await release.promise;
			(a.remote.target as any).model = model;
			(a.remote.target as any).thinkingLevel = thinkingLevel;
		},
	});
	(a.remote.target as any).modelRegistry = {
		getAvailable: () => [
			(a.remote.target as any).model,
			{
				id: "gpt-5.6-sol",
				provider: "openai-codex",
				thinking: {
					supportedLevels: [{ effort: "high", description: "High" }],
					defaultLevel: "high",
				},
			},
		],
	};
	a.remote.target.setThinkingLevel = level => {
		(a.remote.target as any).thinkingLevel = level;
	};
	const settings = a.remote.call("model", "thread/settings/update", {
		threadId: "a",
		model: "gpt-5.6-sol",
		effort: "high",
	});
	const turn = a.remote.call("turn", "turn/start", {
		threadId: "a",
		model: "gpt-5.6-sol",
		effort: "high",
		input: [{ type: "text", text: "use the selected model" }],
	});
	await Bun.sleep(0);
	expect(a.prompts).toEqual([]);
	release.resolve();
	await settings;
	await turn;
	expect(a.remote.target.model?.id).toBe("gpt-5.6-sol");
	expect(a.prompts).toEqual(["use the selected model"]);
	a.finish();
	a.remote.dispose();
});

test("the phone catalog excludes a historical active model", () => {
	const a = fixture("a");
	(a.remote.target as any).model = { id: "gpt-5.4", provider: "openai-codex" };
	(a.remote.target as any).modelRegistry = {
		getAvailable: () => [
			(a.remote.target as any).model,
			{ id: "gpt-5.6-luna", provider: "openai-codex", input: ["text"] },
		],
	};
	expect(a.remote.models().map(model => model.id)).toEqual(["gpt-5.6-luna"]);
	a.remote.dispose();
});
test("phone collaboration modes validate before applying and precede turn execution", async () => {
	const applied: string[] = [];
	let current: "plan" | "default" = "default";
	const a = fixture("a", {
		getCollaborationMode: () => current,
		setCollaborationMode: async mode => {
			applied.push(mode);
			current = mode;
		},
	});
	const levels: unknown[] = [];
	a.remote.target.setThinkingLevel = level => levels.push(level);
	const events: any[] = [];
	a.remote.subscribe(event => events.push(event));
	const plan = {
		mode: "plan",
		settings: { model: "gpt-6-astra", reasoning_effort: "medium", developer_instructions: null },
	};
	expect(
		await a.remote.call("settings-plan", "thread/settings/update", {
			threadId: "a",
			collaborationMode: plan,
		}),
	).toEqual({});
	expect(applied).toEqual(["plan"]);
	expect(levels).toEqual(["medium"]);
	expect(events.at(-1)?.params.threadSettings.collaborationMode.mode).toBe("plan");
	const started = await a.remote.call("turn-default", "turn/start", {
		threadId: "a",
		input: [{ type: "text", text: "execute" }],
		collaborationMode: {
			mode: "default",
			settings: { model: "gpt-6-astra", reasoning_effort: "high", developer_instructions: null },
		},
	});
	expect(started).toMatchObject({ turn: { status: "inProgress" } });
	expect(applied).toEqual(["plan", "default"]);
	expect(levels).toEqual(["medium", "high"]);
	expect(a.prompts).toEqual(["execute"]);
	a.finish();
	a.remote.dispose();

	for (const collaborationMode of [
		{ mode: "custom", settings: { model: "gpt-6-astra" } },
		{ mode: "plan", settings: null },
		{ mode: "plan", settings: { model: "other" } },
		{ mode: "plan", settings: { model: "gpt-6-astra", developer_instructions: "custom" } },
	]) {
		const changed: string[] = [];
		const levelsBeforeFailure: unknown[] = [];
		const invalid = fixture("invalid", {
			setCollaborationMode: async mode => {
				changed.push(mode);
			},
		});
		invalid.remote.target.setThinkingLevel = level => levelsBeforeFailure.push(level);
		await expect(
			invalid.remote.call("invalid", "thread/settings/update", {
				threadId: "invalid",
				effort: "medium",
				collaborationMode,
			}),
		).rejects.toMatchObject({ code: -32602 });
		expect(changed).toEqual([]);
		expect(levelsBeforeFailure).toEqual([]);
		expect(invalid.prompts).toEqual([]);
		invalid.remote.dispose();
	}
});
test("unsupported model effort is rejected before the runtime can silently clamp it", async () => {
	const a = fixture("a");
	(a.remote.target.model as any).thinking = {
		supportedLevels: [{ effort: "medium", description: "Medium" }],
		defaultLevel: "medium",
	};
	let changed = false;
	a.remote.target.setThinkingLevel = () => {
		changed = true;
	};
	await expect(
		a.remote.call("unsupported-effort", "turn/start", {
			threadId: "a",
			effort: "none",
			input: [{ type: "text", text: "fixture" }],
		}),
	).rejects.toMatchObject({ code: -32602 });
	expect(changed).toBe(false);
	expect(a.prompts).toEqual([]);
	a.remote.dispose();
});
