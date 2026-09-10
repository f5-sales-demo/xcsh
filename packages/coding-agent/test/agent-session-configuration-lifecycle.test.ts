import { afterEach, expect, test, vi } from "bun:test";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession, type AgentSessionConfig } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
});
async function fixture(extra: Partial<AgentSessionConfig> = {}) {
	const auth = await AuthStorage.create(":memory:");
	cleanup.push(() => auth.close());
	auth.setRuntimeApiKey("anthropic", "test-key");
	const registry = new ModelRegistry(auth);
	const original = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	const target = getBundledModel("anthropic", "claude-sonnet-5")!;
	const settings = Settings.isolated({ "compaction.enabled": false, "context.loadingMode": "progressive" });
	settings.setModelRole("default", `${original.provider}/${original.id}`);
	const manager = SessionManager.inMemory();
	manager.appendModelChange(`${original.provider}/${original.id}`);
	const session = new AgentSession({
		agent: new Agent({ initialState: { model: original, systemPrompt: "Original prompt", tools: [], messages: [] } }),
		sessionManager: manager,
		settings,
		modelRegistry: registry,
		...extra,
	});
	cleanup.push(() => session.dispose());
	return { session, registry, original, target, manager };
}

for (const method of [
	"setModel",
	"setModelTemporary",
	"setModelRoutingSwitch",
	"cycleModel",
	"cycleScopedModel",
] as const) {
	test.each(
		method === "setModelRoutingSwitch" ? ["new", "close", "selection", "abort"] : ["new", "close", "selection"],
	)(`${method} awaiting credentials cannot overwrite a later %s`, async action => {
		const { session, registry, original, target, manager } = await fixture(
			method === "cycleScopedModel"
				? {
						scopedModels: [
							{ model: getBundledModel("anthropic", "claude-sonnet-4-5")! },
							{ model: getBundledModel("anthropic", "claude-sonnet-5")! },
						],
					}
				: {},
		);
		vi.spyOn(registry, "getAvailable").mockReturnValue([original, target]);
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		vi.spyOn(registry, method === "cycleScopedModel" ? "getApiKeyForProvider" : "getApiKey").mockImplementationOnce(
			async () => {
				entered.resolve();
				await release.promise;
				return "test-key";
			},
		);
		const pending = (
			method === "cycleModel" || method === "cycleScopedModel" ? session.cycleModel() : session[method](target)
		).catch(error => error);
		let before: ReturnType<typeof manager.getBranch> = [];
		try {
			await entered.promise;
			if (action === "new") await session.newSession();
			else if (action === "close") await session.dispose();
			else if (action === "abort") await session.abort();
			else await session.setModel(original);
			before = structuredClone(manager.getBranch());
		} finally {
			release.resolve();
			await pending;
		}
		expect(session.model).toEqual(original);
		expect(manager.getBranch()).toEqual(before);
		expect(session.settings.getModelRole("default")).toBe(`${original.provider}/${original.id}`);
	});
}

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: name,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: name }], details: undefined }),
	};
}

for (const operation of ["select", "refresh"]) {
	test.each(["new", "close", "selection", "failure"])(
		`a pending ${operation} tool prompt rebuild cannot overwrite a later %s`,
		async action => {
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			let first = true;
			const { session, manager } = await fixture({
				toolRegistry: new Map([
					["first", tool("first")],
					["second", tool("second")],
				]),
				rebuildSystemPrompt: async names => {
					if (first) {
						first = false;
						entered.resolve();
						await release.promise;
						if (action === "failure") throw new Error("Rebuild failed");
					}
					return `Tools: ${names.join(",")}`;
				},
			});
			const originalTools = session.getActiveToolNames();
			const pending = (
				operation === "select" ? session.setActiveToolsByName(["first"]) : session.refreshBaseSystemPrompt()
			).then(
				() => undefined,
				error => error,
			);
			let before: ReturnType<typeof manager.getBranch> = [];
			let prompt = "";
			let tools: string[] = [];
			try {
				await entered.promise;
				if (action === "new") await session.newSession();
				if (action === "close") await session.dispose();
				else if (action !== "failure") await session.setActiveToolsByName(["second"]);
				before = structuredClone(manager.getBranch());
				prompt = session.systemPrompt;
				tools = action === "failure" ? originalTools : session.getActiveToolNames();
			} finally {
				release.resolve();
			}
			const result = await pending;
			if (action === "failure") expect(result).toBeInstanceOf(Error);
			expect(session.systemPrompt).toBe(prompt);
			expect(session.getActiveToolNames()).toEqual(tools);
			expect(manager.getBranch()).toEqual(before);
		},
	);
}

test.each(["new", "close", "selection", "abort"])(
	"fallback restoration waiting on credentials cannot overwrite a later %s",
	async action => {
		const { session, registry, original, target, manager } = await fixture();
		session.settings.set("retry.baseDelayMs", 5);
		session.settings.set("retry.fallbackChains", { default: [`${target.provider}/${target.id}`] });
		session.settings.set("retry.fallbackRevertPolicy", "cooldown-expiry");
		const requests: string[] = [];
		session.agent.streamFn = model => {
			requests.push(model.id);
			return replyStream(model, requests.length === 1, "rate limit exceeded retry-after-ms=60000");
		};
		await session.prompt("Trigger fallback");
		await session.waitForIdle();
		expect(session.model).toEqual(target);
		expect(requests).toEqual([original.id, target.id]);
		registry.suppressSelector(`${original.provider}/${original.id}`, 0);
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		vi.spyOn(registry, "getApiKey").mockImplementationOnce(async () => {
			entered.resolve();
			await release.promise;
			return "test-key";
		});
		const pending = session.prompt("An older prompt").catch(error => error);
		let before: ReturnType<typeof manager.getBranch> = [];
		try {
			await entered.promise;
			if (action === "new") await session.newSession();
			else if (action === "close") await session.dispose();
			else if (action === "abort") await session.abort();
			else await session.setModel(target);
			before = structuredClone(manager.getBranch());
		} finally {
			release.resolve();
			await pending;
		}
		expect(session.model).toEqual(target);
		expect(manager.getBranch().filter(entry => entry.type === "model_change")).toEqual(
			before.filter(entry => entry.type === "model_change"),
		);
		if (action !== "selection") expect(manager.getBranch()).toEqual(before);
		expect(requests).toEqual(action === "selection" ? [original.id, target.id, target.id] : [original.id, target.id]);
	},
);

test("a newer prompt refresh wins without cancelling an explicit pending tool selection", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let calls = 0;
	const { session } = await fixture({
		toolRegistry: new Map([["first", tool("first")]]),
		rebuildSystemPrompt: async names => {
			const call = ++calls;
			if (call === 1) {
				entered.resolve();
				await release.promise;
			}
			return `${call}:${names.join(",")}`;
		},
	});
	const pending = session.setActiveToolsByName(["first"]);
	try {
		await entered.promise;
		await session.refreshBaseSystemPrompt();
	} finally {
		release.resolve();
		await pending;
	}
	expect(session.getActiveToolNames()).toEqual(["first"]);
	expect(session.systemPrompt).toBe("1:first");
});

test("an older prompt refresh cannot replace a newer refresh result", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let calls = 0;
	const { session } = await fixture({
		rebuildSystemPrompt: async () => {
			const call = ++calls;
			if (call === 1) {
				entered.resolve();
				await release.promise;
			}
			return `Refresh ${call}`;
		},
	});
	const pending = session.refreshBaseSystemPrompt();
	try {
		await entered.promise;
		await session.refreshBaseSystemPrompt();
	} finally {
		release.resolve();
		await pending;
	}
	expect(session.systemPrompt).toBe("Refresh 2");
});

test.each(["new", "close", "abort"])(
	"initial retry fallback waiting on credentials cannot mutate after %s",
	async action => {
		const agent = new Agent({
			initialState: { model: getBundledModel("anthropic", "claude-sonnet-4-5")!, tools: [], messages: [] },
		});
		let settlement: Promise<void> | undefined;
		const subscribe = agent.subscribe.bind(agent);
		vi.spyOn(agent, "subscribe").mockImplementation(listener =>
			subscribe(event => {
				const result = listener(event);
				if (event.type === "agent_end") settlement = Promise.resolve(result);
				return result;
			}),
		);
		const { session, registry, original, target, manager } = await fixture({ agent });
		session.settings.set("retry.baseDelayMs", 5);
		session.settings.set("retry.fallbackChains", { default: [`${target.provider}/${target.id}`] });
		const requests: string[] = [];
		session.agent.streamFn = model => {
			requests.push(model.id);
			return replyStream(model, requests.length === 1, "rate limit exceeded retry-after-ms=100");
		};
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const key = registry.getApiKey.bind(registry);
		let blocked = false;
		vi.spyOn(registry, "getApiKey").mockImplementation(async (...args) => {
			if (!blocked && args[0].id === target.id) {
				blocked = true;
				entered.resolve();
				await release.promise;
			}
			return key(...args);
		});
		const pending = session.prompt("Trigger a retry").catch(error => error);
		await entered.promise;
		const transition =
			action === "new" ? session.newSession() : action === "abort" ? session.abort() : session.dispose();
		try {
			await Bun.sleep(20);
		} finally {
			release.resolve();
			await Promise.all([pending, transition, settlement]);
		}
		expect(session.model).toEqual(original);
		expect(
			manager
				.getBranch()
				.filter(entry => entry.type === "model_change")
				.map(entry => entry.model),
		).toEqual([`${original.provider}/${original.id}`]);
		expect(requests).toEqual([original.id]);
	},
);

function replyStream(model: Model, failed: boolean, errorMessage: string): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: failed ? "" : "Done" }],
		provider: model.provider,
		model: model.id,
		api: model.api,
		stopReason: failed ? "error" : "stop",
		...(failed ? { errorMessage } : {}),
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	queueMicrotask(() => {
		if (failed) stream.push({ type: "error", reason: "error", error: message });
		else stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

test("a retry without a fallback preserves a pending manual model selection", async () => {
	const { session, registry, original, target } = await fixture();
	session.settings.set("retry.baseDelayMs", 5);
	session.settings.set("retry.fallbackChains", {});
	const requests: string[] = [];
	session.agent.streamFn = model => {
		requests.push(model.id);
		return replyStream(model, requests.length === 1, "overloaded");
	};
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const key = registry.getApiKey.bind(registry);
	vi.spyOn(registry, "getApiKey").mockImplementation(async (...args) => {
		if (args[0].id === target.id) {
			entered.resolve();
			await release.promise;
		}
		return key(...args);
	});
	const selection = session.setModel(target);
	try {
		await entered.promise;
		await session.prompt("Work through a temporary overload");
		await session.waitForIdle();
	} finally {
		release.resolve();
		await selection;
	}
	expect(requests).toEqual([original.id, original.id]);
	expect(session.model).toEqual(target);
	expect(session.settings.getModelRole("default")).toBe(`${target.provider}/${target.id}`);
});

test("a pending manual model selection survives task abort", async () => {
	const { session, registry, target } = await fixture();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	vi.spyOn(registry, "getApiKey").mockImplementationOnce(async () => {
		entered.resolve();
		await release.promise;
		return "test-key";
	});
	const pending = session.setModel(target);
	try {
		await entered.promise;
		await session.abort();
	} finally {
		release.resolve();
		await pending;
	}
	expect(session.model).toEqual(target);
	expect(session.settings.getModelRole("default")).toBe(`${target.provider}/${target.id}`);
});
