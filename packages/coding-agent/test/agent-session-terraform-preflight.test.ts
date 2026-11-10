import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentMessage, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import type { ProviderReleaseMetadata } from "../src/internal-urls/provider-release";
import { classifyTerraformPreflight, type TerraformPreflightOptions } from "../src/internal-urls/terraform-preflight";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";

class MockAssistantStream extends AssistantMessageEventStream {}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const result: ProviderReleaseMetadata = {
	latestVersion: "15.3.0",
	embeddedDocumentationVersion: "15.2.0",
	lookedUpAt: "2026-10-06T12:00:00.000Z",
	attemptedAt: "2026-10-06T12:00:00.000Z",
	sourceUrl: "https://registry.terraform.io/v1/providers/f5-sales-demo/xcsh/versions",
	freshness: "fresh",
	lookupFailure: null,
};

describe("AgentSession Terraform preflight", () => {
	let auth: AuthStorage;
	let session: AgentSession | undefined;

	beforeEach(async () => {
		auth = await AuthStorage.create(":memory:");
		auth.setRuntimeApiKey("anthropic", "test-key");
	});

	afterEach(async () => {
		await session?.dispose();
		auth.close();
	});

	function createSession(
		preflight: (prompt: string, options: TerraformPreflightOptions) => Promise<ProviderReleaseMetadata | null>,
		onMessages?: (messages: Message[]) => void,
	) {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("fixture model unavailable");
		const read: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read",
			parameters: Type.Object({ path: Type.String() }),
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		};
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [read], messages: [] },
			convertToLlm,
			streamFn: (_model, context) => {
				onMessages?.([...context.messages]);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant("") });
					stream.push({ type: "done", reason: "stop", message: assistant("done") });
				});
				return stream;
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
			toolRegistry: new Map([["read", read]]),
			apiCatalogPreflight: async () => null,
			terraformPreflight: async (prompt, options) => preflight(prompt, options),
		});
		return session;
	}

	it("injects terraform-preflight before the user prompt and first model inference", async () => {
		let providerMessages: Message[] = [];
		const current = createSession(
			async () => result,
			messages => {
				providerMessages = messages;
			},
		);
		await current.prompt("Write Terraform for an origin pool");

		const transcript = current.messages as AgentMessage[];
		const preflightIndex = transcript.findIndex(
			message => message.role === "custom" && message.customType === "terraform-preflight",
		);
		const userIndex = transcript.findIndex(message => message.role === "user");
		expect(preflightIndex).toBeGreaterThanOrEqual(0);
		expect(preflightIndex).toBeLessThan(userIndex);
		expect(providerMessages.some(message => JSON.stringify(message).includes("15.3.0"))).toBe(true);
	});

	it("refreshes on each relevant turn and clears unrelated continuation", async () => {
		const observed: boolean[] = [];
		const current = createSession(async (text, options) => {
			observed.push(options.previousTerraform);
			return classifyTerraformPreflight(text, options.previousTerraform) ? result : null;
		});
		await current.prompt("Write Terraform for an origin pool");
		await current.prompt("Now validate it");
		await current.prompt("What time is it?");
		await current.prompt("Now validate it");
		expect(observed).toEqual([false, true, true, false]);
		expect(current.messages.filter(m => m.role === "custom" && m.customType === "terraform-preflight")).toHaveLength(
			2,
		);
	});
	it("resets continuation when a new session starts", async () => {
		const observed: boolean[] = [];
		const current = createSession(async (text, options) => {
			observed.push(options.previousTerraform);
			return classifyTerraformPreflight(text, options.previousTerraform) ? result : null;
		});
		await current.prompt("Write Terraform for an origin pool");
		expect(await current.newSession()).toBe(true);
		await current.prompt("Now validate it");
		expect(observed).toEqual([false, false]);
	});
	it("injects offline fallback and warning before inference", async () => {
		let providerMessages: Message[] = [];
		const current = createSession(
			async () => ({ ...result, freshness: "cached", lookupFailure: "offline" }),
			messages => {
				providerMessages = messages;
			},
		);
		await current.prompt("Write Terraform for an origin pool");
		const context = JSON.stringify(providerMessages);
		expect(context).toContain("cached");
		expect(context).toContain("offline");
		expect(context).toContain("do not downgrade");
	});
	it("does not settle a newer prompt when an aborted preflight rejects late", async () => {
		let firstReady!: () => void;
		let secondReady!: () => void;
		const firstStarted = new Promise<void>(resolve => {
			firstReady = resolve;
		});
		const secondStarted = new Promise<void>(resolve => {
			secondReady = resolve;
		});
		let rejectFirst!: (error: Error) => void;
		let releaseSecond!: (result: ProviderReleaseMetadata | null) => void;
		let attempts = 0;
		const current = createSession(async () => {
			if (++attempts === 1) {
				firstReady();
				return new Promise((_resolve, reject) => {
					rejectFirst = reject;
				});
			}
			secondReady();
			return new Promise(resolve => {
				releaseSecond = resolve;
			});
		});
		const phases: Array<{ phase: string; turnId: number }> = [];
		current.subscribe(event => {
			if (event.type === "turn_phase") phases.push(event);
		});
		const first = current.prompt("Write Terraform first").catch(() => undefined);
		await firstStarted;
		await current.abort();
		const second = current.prompt("Write Terraform second");
		await secondStarted;
		const newer = phases.at(-1);
		rejectFirst(new Error("late aborted preflight"));
		await first;
		expect(current.isStreaming).toBe(true);
		expect(phases.at(-1)).toEqual(newer);
		expect(newer?.phase).toBe("submitting");
		releaseSecond(null);
		await second;
		expect(phases.at(-1)?.phase).toBe("idle");
	});

	it("cancels preflight during abort without inference or stale context", async () => {
		let calls = 0;
		let started!: () => void;
		const ready = new Promise<void>(resolve => {
			started = resolve;
		});
		const current = createSession(
			async (_text, options) => {
				started();
				return new Promise((_resolve, reject) =>
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }),
				);
			},
			() => {
				calls++;
			},
		);
		const pending = current.prompt("Write Terraform");
		const phases: string[] = [];
		current.subscribe(event => {
			if (event.type === "turn_phase") phases.push(event.phase);
		});
		const caught = pending.catch(() => undefined);
		await ready;
		await current.abort();
		await caught;
		expect(calls).toBe(0);
		expect(phases).toContain("cancelled");
		expect(phases).not.toContain("error");
		expect(current.messages.some(m => m.role === "custom" && m.customType === "terraform-preflight")).toBe(false);
	});
});
