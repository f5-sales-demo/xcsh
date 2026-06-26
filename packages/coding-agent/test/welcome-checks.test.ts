import { describe, expect, it } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { runWelcomeChecks, validateContextWithStartupRetry } from "@f5-sales-demo/xcsh/modes/components/welcome-checks";

function mockAuth(opts: { hasAuth?: boolean; peekApiKey?: string | undefined }) {
	return { hasAuth: () => opts.hasAuth ?? false, peekApiKey: async () => opts.peekApiKey } as any;
}
function mockModel(overrides: Partial<Model> = {}): Model {
	return {
		id: "t",
		name: "T",
		api: "openai-completions" as any,
		provider: "litellm",
		baseUrl: "http://localhost:4000/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	} as Model;
}

describe("runWelcomeChecks", () => {
	it("returns no_provider when hasAuth is false", async () => {
		const r = await runWelcomeChecks(mockModel(), mockAuth({ hasAuth: false }));
		expect(r.model.state).toBe("no_provider");
		expect(r.context).toBeUndefined();
	});
	it("returns no_provider for undefined model", async () => {
		const r = await runWelcomeChecks(undefined, mockAuth({ hasAuth: false }));
		expect(r.model.provider).toBe("unknown");
	});
	it("returns auth_error when peekApiKey undefined", async () => {
		const r = await runWelcomeChecks(mockModel(), mockAuth({ hasAuth: true, peekApiKey: undefined }));
		expect(r.model.state).toBe("auth_error");
		expect(r.context).toBeUndefined();
	});
	it("returns auth_error for empty baseUrl", async () => {
		const r = await runWelcomeChecks(mockModel({ baseUrl: "" }), mockAuth({ hasAuth: true, peekApiKey: "k" }));
		expect(r.model.state).toBe("auth_error");
	});
	it("returns auth_error when peekApiKey returns an unresolved env var name", async () => {
		const r = await runWelcomeChecks(mockModel(), mockAuth({ hasAuth: true, peekApiKey: "LITELLM_API_KEY" }));
		expect(r.model.state).toBe("auth_error");
	});
	it("never includes context when model fails", async () => {
		const r = await runWelcomeChecks(mockModel(), mockAuth({ hasAuth: false }));
		expect(r.context).toBeUndefined();
	});
});

describe("validateContextWithStartupRetry", () => {
	it("propagates errorClass from validator result", async () => {
		const validator = async () => ({
			status: "offline" as const,
			latencyMs: 42,
			errorClass: "url_not_found" as const,
		});
		const result = await validateContextWithStartupRetry(validator, {
			firstTimeoutMs: 100,
			retryTimeoutMs: 100,
			retryDelayMs: 0,
		});
		expect(result.status).toBe("offline");
		expect(result.errorClass).toBe("url_not_found");
	});
});
