import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentTool } from "@f5-sales-demo/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { ExtensionToolWrapper } from "../src/extensibility/extensions/wrapper";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

describe("scoped tool advisories", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;

	beforeEach(async () => {
		authStorage = await AuthStorage.create(":memory:");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => authStorage.close());

	async function createRunner(factory: Parameters<typeof loadExtensionFromFactory>[0]) {
		const runtime = {
			flagValues: new Map(),
			pendingProviderRegistrations: [],
		} as never;
		const extension = await loadExtensionFromFactory(
			factory,
			"/tmp/advisory-test",
			new EventBus(),
			runtime,
			"plugin:test",
		);
		return new ExtensionRunner([extension], runtime, "/tmp/advisory-test", SessionManager.inMemory(), modelRegistry);
	}

	it("filters by exact capability and preserves owner provenance", async () => {
		const runner = await createRunner(pi => {
			pi.advisories.register({
				id: "regional-edge-source",
				capabilities: ["task", "render_map"],
				match: event =>
					(event.input as Record<string, unknown>).topic === "regional-edge"
						? { code: "registry-source", message: "Prefer the registry collector." }
						: undefined,
			});
		});

		expect(
			await runner.evaluateAdvisories({
				type: "tool_call",
				toolName: "bash",
				toolCallId: "unrelated",
				input: { topic: "regional-edge" },
			}),
		).toEqual({ advisories: [], diagnostics: [] });

		const result = await runner.evaluateAdvisories({
			type: "tool_call",
			toolName: "task",
			toolCallId: "matched",
			input: { topic: "regional-edge" },
		});
		expect(result.advisories).toEqual([
			{
				code: "registry-source",
				message: "Prefer the registry collector.",
				severity: "warning",
				provenance: { owner: "plugin:test", registrationId: "regional-edge-source", capability: "task" },
			},
		]);
		expect(result.diagnostics).toEqual([]);
	});

	it("fails open when a matcher throws and continues evaluating later registrations", async () => {
		const runner = await createRunner(pi => {
			pi.advisories.register({
				id: "broken",
				capabilities: ["task"],
				match: () => {
					throw new Error("matcher exploded");
				},
			});
			pi.advisories.register({
				id: "healthy",
				capabilities: ["task"],
				match: () => ({ code: "continue", message: "The request still runs." }),
			});
		});

		const result = await runner.evaluateAdvisories({
			type: "tool_call",
			toolName: "task",
			toolCallId: "call",
			input: {},
		});
		expect(result.advisories.map(item => item.code)).toEqual(["continue"]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({
				code: "advisory_matcher_failed",
				owner: "plugin:test",
				registrationId: "broken",
				capability: "task",
				message: "matcher exploded",
			}),
		]);
	});

	it("renders advisories without preventing the requested tool execution", async () => {
		let executed = false;
		const runner = await createRunner(pi => {
			pi.advisories.register({
				id: "advice",
				capabilities: ["task"],
				match: () => ({ code: "use-direct", message: "Prefer direct collection." }),
			});
		});
		const tool: AgentTool = {
			name: "task",
			label: "Task",
			description: "test",
			parameters: Type.Object({}),
			async execute() {
				executed = true;
				return { content: [{ type: "text", text: "tool result" }], details: { original: true } };
			},
		};

		const result = await new ExtensionToolWrapper(tool, runner).execute("call", {});
		expect(executed).toBe(true);
		expect(result.content.at(-1)).toEqual({
			type: "text",
			text: "Advisory [use-direct] (plugin:test): Prefer direct collection.",
		});
		expect(result.details).toMatchObject({
			original: true,
			advisories: [{ code: "use-direct" }],
		});
	});

	it("removes registrations by owner for reload, disablement, and uninstall", async () => {
		const runner = await createRunner(pi => {
			pi.advisories.register({
				id: "owned",
				capabilities: ["task"],
				match: () => ({ code: "owned", message: "owned" }),
			});
		});
		expect(runner.removeAdvisoryOwner("plugin:test")).toBe(1);
		expect(
			await runner.evaluateAdvisories({ type: "tool_call", toolName: "task", toolCallId: "after", input: {} }),
		).toEqual({ advisories: [], diagnostics: [] });
	});

	it("atomically reloads the active extension advisory set", async () => {
		const runner = await createRunner(pi => {
			pi.advisories.register({
				id: "old",
				capabilities: ["task"],
				match: () => ({ code: "old", message: "stale" }),
			});
		});
		const runtime = { flagValues: new Map(), pendingProviderRegistrations: [] } as never;
		const replacement = await loadExtensionFromFactory(
			pi => {
				pi.advisories.register({
					id: "new",
					capabilities: ["task"],
					match: () => ({ code: "new", message: "current" }),
				});
			},
			"/tmp/advisory-test",
			new EventBus(),
			runtime,
			"plugin:test",
		);

		runner.reloadAdvisories([replacement]);
		const result = await runner.evaluateAdvisories({
			type: "tool_call",
			toolName: "task",
			toolCallId: "reload",
			input: {},
		});
		expect(result.advisories.map(item => item.code)).toEqual(["new"]);
	});
});
