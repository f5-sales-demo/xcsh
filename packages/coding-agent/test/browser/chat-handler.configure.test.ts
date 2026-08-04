import { describe, expect, it } from "bun:test";
import { ChatHandler } from "../../src/browser/chat-handler";
import type { BridgeServer } from "../../src/browser/extension-bridge";
import type { AgentSession } from "../../src/session/agent-session";

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
	readonly serveKind: "browser" | "office";
	readonly clientHost: "excel" | null;
	sent: Array<Record<string, unknown>> = [];
	#onMessage: Array<(m: Record<string, unknown>) => void> = [];
	#onDisconnected: Array<() => void> = [];

	constructor(serveKind: "browser" | "office" = "office") {
		this.serveKind = serveKind;
		this.clientHost = serveKind === "office" ? "excel" : null;
	}

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
	// The models this registry can resolve; provider "litellm" is the baked xcsh default.
	models: Array<{ provider: string; id: string }> = [
		{ provider: "litellm", id: "gpt-5.6-sol" },
		{ provider: "litellm", id: "gpt-5.6-terra" },
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
	setThinkingLevelCalls: string[] = [];
	isStreaming = false;
	// Read by the handler to expand a `/name` before composing; the `as unknown as
	// AgentSession` cast means tsc cannot flag its absence.
	readonly slashCommands = [];
	modelRegistry = new FakeModelRegistry();
	// Current default model (used when `configure` omits `model`).
	model = { provider: "litellm", id: "gpt-5.6-sol" };
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
	setThinkingLevel(level: string): void {
		this.setThinkingLevelCalls.push(level);
	}
}

function makeHandler(serveKind: "browser" | "office" = "office"): {
	handler: ChatHandler;
	server: FakeBridgeServer;
	session: FakeAgentSession;
} {
	const server = new FakeBridgeServer(serveKind);
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
	it("ignores provider configuration from the Chrome extension profile", async () => {
		const { server, session } = makeHandler("browser");
		server.emit({ type: "configure", token: "<XC_API_TOKEN>" });
		await flush();

		expect(session.modelRegistry.runtimeApiKeys).toHaveLength(0);
		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		expect(server.ofType("configure_error")).toHaveLength(0);
	});

	it("(a) baseUrl+token+model → registerProvider with the gateway config, setModel, configure_ack", async () => {
		const { server, session } = makeHandler();
		server.emit({
			type: "configure",
			baseUrl: "https://f5ai.pd.f5net.com/v1",
			token: "<XC_API_TOKEN>",
			model: "gpt-5.6-terra",
		});
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(1);
		const call = session.modelRegistry.registerProviderCalls[0];
		expect(call.providerName).toBe("litellm");
		expect(call.config.baseUrl).toBe("https://f5ai.pd.f5net.com/v1");
		expect(call.config.apiKey).toBe("<XC_API_TOKEN>");
		expect(call.config.headers).toBeUndefined();
		expect(call.sourceId).toBe("office-configure");
		// No models[] → registerProvider overrides the existing LiteLLM models, not persisted.
		expect(call.config.models).toBeUndefined();

		expect(session.setModelCalls).toEqual([{ provider: "litellm", id: "gpt-5.6-terra" }]);
		expect(session.setThinkingLevelCalls).toEqual(["high"]);

		const acks = server.ofType("configure_ack");
		expect(acks).toHaveLength(1);
		expect(acks[0].model).toBe("gpt-5.6-terra");
		expect(server.ofType("configure_error")).toHaveLength(0);
	});

	it("(a2) model omitted → selects the session's current default model id", async () => {
		const { server, session } = makeHandler();
		server.emit({
			type: "configure",
			baseUrl: "https://f5ai.pd.f5net.com/v1",
			token: "<XC_API_TOKEN>",
		});
		await flush();

		expect(session.setModelCalls).toEqual([{ provider: "litellm", id: "gpt-5.6-sol" }]);
		expect(server.ofType("configure_ack")[0].model).toBe("gpt-5.6-sol");
	});

	it("model omitted after another provider was active → restores the baked LiteLLM default", async () => {
		const { server, session } = makeHandler();
		session.model = { provider: "google-vertex", id: "gemini-3.6-flash" };
		server.emit({ type: "configure", token: "<XC_API_TOKEN>" });
		await flush();

		expect(session.modelRegistry.runtimeApiKeys).toEqual([{ provider: "litellm", apiKey: "<XC_API_TOKEN>" }]);
		expect(session.setModelCalls).toEqual([{ provider: "litellm", id: "gpt-5.6-sol" }]);
		expect(session.setThinkingLevelCalls).toEqual(["high"]);
	});

	it("(b) key-only (no baseUrl) → setRuntimeApiKey path, no registerProvider", async () => {
		const { server, session } = makeHandler();
		server.emit({ type: "configure", token: "<XC_API_TOKEN>", model: "gpt-5.6-sol" });
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toEqual([{ provider: "litellm", apiKey: "<XC_API_TOKEN>" }]);
		expect(session.setModelCalls).toEqual([{ provider: "litellm", id: "gpt-5.6-sol" }]);
		expect(server.ofType("configure_ack")[0].model).toBe("gpt-5.6-sol");
	});

	it("(c) setModel throws (missing key) → configure_error, no throw escapes, no ack", async () => {
		const { server, session } = makeHandler();
		session.setModelError = new Error("No API key for litellm/gpt-5.6-sol");
		// Must not throw synchronously or asynchronously out of the handler.
		expect(() => server.emit({ type: "configure", token: "<XC_API_TOKEN>" })).not.toThrow();
		await flush();

		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(errs[0]).toEqual({ type: "configure_error", reason: "configuration-rejected" });
	});

	it("(c2) unknown model id → configure_error (find returns undefined), no throw escapes", async () => {
		const { server, session } = makeHandler();
		expect(() => server.emit({ type: "configure", token: "<XC_API_TOKEN>", model: "no-such-model" })).not.toThrow();
		await flush();

		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(errs[0]).toEqual({ type: "configure_error", reason: "configuration-rejected" });
	});

	it("(e) non-https baseUrl → configure_error, registerProvider never called (SSRF guard)", async () => {
		const { server, session } = makeHandler();
		expect(() =>
			server.emit({
				type: "configure",
				baseUrl: "http://gateway.example.internal/v1",
				token: "<XC_API_TOKEN>",
			}),
		).not.toThrow();
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toHaveLength(0);
		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		const errs = server.ofType("configure_error");
		expect(errs).toHaveLength(1);
		expect(errs[0]).toEqual({ type: "configure_error", reason: "configuration-rejected" });
	});

	it("(e2) malformed baseUrl → configure_error, registerProvider never called", async () => {
		const { server, session } = makeHandler();
		expect(() => server.emit({ type: "configure", baseUrl: "not-a-url", token: "<XC_API_TOKEN>" })).not.toThrow();
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
			baseUrl: "https://127-0-0-1.local-ip.sh:8443/v1",
			token: "<XC_API_TOKEN>",
			model: "gpt-5.6-sol",
		});
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(1);
		expect(session.modelRegistry.registerProviderCalls[0].config.baseUrl).toBe(
			"https://127-0-0-1.local-ip.sh:8443/v1",
		);
		expect(server.ofType("configure_ack")[0].model).toBe("gpt-5.6-sol");
	});

	it("(d) missing/empty token → frame rejected (no ack, no error, no side effects)", async () => {
		const { server, session } = makeHandler();
		server.emit({ type: "configure", baseUrl: "https://f5ai.pd.f5net.com/v1" }); // no token
		server.emit({ type: "configure", token: "" }); // empty token
		await flush();

		expect(session.modelRegistry.registerProviderCalls).toHaveLength(0);
		expect(session.modelRegistry.runtimeApiKeys).toHaveLength(0);
		expect(session.setModelCalls).toHaveLength(0);
		expect(server.ofType("configure_ack")).toHaveLength(0);
		expect(server.ofType("configure_error")).toHaveLength(0);
	});
});
