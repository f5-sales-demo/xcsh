import { describe, expect, it } from "bun:test";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession } from "@f5-sales-demo/xcsh/session/agent-session";

/**
 * `configure` frame wiring tests for `ChatHandler` (runtime provider configuration,
 * mirroring the `set_host_tools` precedent #2046).
 *
 * A fake `BridgeServer` captures every `send()` frame and drives the inbound
 * `onMessage` path. A stub `AgentSession` exposes a fake `modelRegistry`
 * (registerProvider / find / authStorage.setRuntimeApiKey) plus `setModel`, so the
 * test can assert the session-only, non-persistent provider swap and the ack/nack.
 */
class FakeBridgeServer {
	sent: Array<Record<string, unknown>> = [];
	#onMessage: Array<(m: Record<string, unknown>) => void> = [];
	#onDisconnected: Array<() => void> = [];

	send(payload: unknown): void {
		this.sent.push(payload as Record<string, unknown>);
	}
	onMessage(cb: (m: Record<string, unknown>) => void): void {
		this.#onMessage.push(cb);
	}
	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	emit(msg: Record<string, unknown>): void {
		for (const cb of this.#onMessage) cb(msg);
	}
	ofType(type: string): Array<Record<string, unknown>> {
		return this.sent.filter(frame => frame.type === type);
	}
}

interface RegisterProviderCall {
	providerName: string;
	config: Record<string, unknown>;
	sourceId?: string;
}

class FakeModelRegistry {
	registerProviderCalls: RegisterProviderCall[] = [];
	runtimeApiKeys: Array<{ provider: string; apiKey: string }> = [];
	// The models this registry can resolve; provider "anthropic" is the baked F5 default.
	models: Array<{ provider: string; id: string }> = [
		{ provider: "anthropic", id: "claude-opus-4-8" },
		{ provider: "anthropic", id: "claude-sonnet-4-5" },
	];

	authStorage = {
		setRuntimeApiKey: (provider: string, apiKey: string): void => {
			this.runtimeApiKeys.push({ provider, apiKey });
		},
	};

	registerProvider(providerName: string, config: Record<string, unknown>, sourceId?: string): void {
		this.registerProviderCalls.push({ providerName, config, sourceId });
	}

	find(provider: string, modelId: string): { provider: string; id: string } | undefined {
		return this.models.find(m => m.provider === provider && m.id === modelId);
	}
}

class FakeAgentSession {
	setModelCalls: Array<{ provider: string; id: string }> = [];
	isStreaming = false;
	modelRegistry = new FakeModelRegistry();
	// Current default model (used when `configure` omits `model`).
	model = { provider: "anthropic", id: "claude-opus-4-8" };
	agent = {
		abort(): void {},
		replaceMessages(): void {},
	};
	/** When set, setModel rejects — simulates a missing/invalid API key. */
	setModelError: Error | null = null;

	subscribe(): () => void {
		return () => {};
	}
	async prompt(): Promise<void> {}
	async setModel(model: { provider: string; id: string }): Promise<void> {
		if (this.setModelError) throw this.setModelError;
		this.setModelCalls.push(model);
	}
}

function makeHandler(): { handler: ChatHandler; server: FakeBridgeServer; session: FakeAgentSession } {
	const server = new FakeBridgeServer();
	const session = new FakeAgentSession();
	const handler = new ChatHandler(server as unknown as BridgeServer, session as unknown as AgentSession);
	handler.attach();
	return { handler, server, session };
}

// Flush the microtask queue so the async #handleConfigure completes.
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("ChatHandler configure frame (#2095)", () => {
	it("(a) baseUrl+token+model → registerProvider with the gateway config, setModel, configure_ack", async () => {
		const { server, session } = makeHandler();
		server.emit({
			type: "configure",
			baseUrl: "https://f5ai.pd.f5net.com/anthropic",
			token: "sk-test-123",
			model: "claude-sonnet-4-5",
		});
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(1);
		const call = session.modelRegistry.registerProviderCalls[0];
		expect(call.providerName).toBe("anthropic");
		expect(call.config.baseUrl).toBe("https://f5ai.pd.f5net.com/anthropic");
		expect(call.config.apiKey).toBe("sk-test-123");
		expect(call.config.headers).toEqual({ "anthropic-beta": "context-1m-2025-08-07" });
		expect(call.sourceId).toBe("office-configure");
		// No models[] → registerProvider overrides the existing anthropic models, not persisted.
		expect(call.config.models).toBeUndefined();

		expect(session.setModelCalls).toEqual([{ provider: "anthropic", id: "claude-sonnet-4-5" }]);

		const acks = server.ofType("configure_ack");
		expect(acks).toHaveLength(1);
		expect(acks[0].model).toBe("claude-sonnet-4-5");
		expect(server.ofType("configure_error")).toHaveLength(0);
	});

	it("(a2) model omitted → selects the session's current default model id", async () => {
		const { server, session } = makeHandler();
		server.emit({
			type: "configure",
			baseUrl: "https://f5ai.pd.f5net.com/anthropic",
			token: "sk-test-123",
		});
		await flush();

		expect(session.setModelCalls).toEqual([{ provider: "anthropic", id: "claude-opus-4-8" }]);
		expect(server.ofType("configure_ack")[0].model).toBe("claude-opus-4-8");
	});

	it("(b) key-only (no baseUrl) → setRuntimeApiKey path, no registerProvider", async () => {
		const { server, session } = makeHandler();
		server.emit({ type: "configure", token: "sk-key-only", model: "claude-opus-4-8" });
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toEqual([{ provider: "anthropic", apiKey: "sk-key-only" }]);
		expect(session.setModelCalls).toEqual([{ provider: "anthropic", id: "claude-opus-4-8" }]);
		expect(server.ofType("configure_ack")[0].model).toBe("claude-opus-4-8");
	});

	it("(c) setModel throws (missing key) → configure_error, no throw escapes, no ack", async () => {
		const { server, session } = makeHandler();
		session.setModelError = new Error("No API key for anthropic/claude-opus-4-8");
		// Must not throw synchronously or asynchronously out of the handler.
		expect(() => server.emit({ type: "configure", token: "sk-bad" })).not.toThrow();
		await flush();

		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(errs[0].error).toBe("No API key for anthropic/claude-opus-4-8");
	});

	it("(c2) unknown model id → configure_error (find returns undefined), no throw escapes", async () => {
		const { server, session } = makeHandler();
		expect(() => server.emit({ type: "configure", token: "sk-x", model: "no-such-model" })).not.toThrow();
		await flush();

		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(typeof errs[0].error).toBe("string");
	});

	it("(e) non-https baseUrl → configure_error, registerProvider never called (SSRF guard)", async () => {
		const { server, session } = makeHandler();
		expect(() =>
			server.emit({ type: "configure", baseUrl: "http://evil.internal/anthropic", token: "sk-x" }),
		).not.toThrow();
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toHaveLength(0);
		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(String(errs[0].error)).toMatch(/https/i);
	});

	it("(e2) malformed baseUrl → configure_error, registerProvider never called", async () => {
		const { server, session } = makeHandler();
		expect(() => server.emit({ type: "configure", baseUrl: "not-a-url", token: "sk-x" })).not.toThrow();
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		expect(server.ofType("configure_error")).toHaveLength(1);
	});

	it("(e3) https loopback gateway (local-ip.sh) is allowed — registerProvider called", async () => {
		const { server, session } = makeHandler();
		// The claude-office CORS proxy is a LEGITIMATE internal target; loopback/private
		// hosts must NOT be blocked.
		server.emit({
			type: "configure",
			baseUrl: "https://127-0-0-1.local-ip.sh:8443/anthropic",
			token: "sk-x",
			model: "claude-opus-4-8",
		});
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(1);
		expect(session.modelRegistry.registerProviderCalls[0].config.baseUrl).toBe(
			"https://127-0-0-1.local-ip.sh:8443/anthropic",
		);
		expect(server.ofType("configure_ack")[0].model).toBe("claude-opus-4-8");
	});

	it("(d) missing/empty token → frame rejected (no ack, no error, no side effects)", async () => {
		const { server, session } = makeHandler();
		server.emit({ type: "configure", baseUrl: "https://f5ai.pd.f5net.com/anthropic" }); // no token
		server.emit({ type: "configure", token: "" }); // empty token
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toHaveLength(0);
		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		expect(server.ofType("configure_error")).toHaveLength(0);
	});
});
