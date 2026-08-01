import { describe, expect, it } from "bun:test";
import type { Model } from "@f5-sales-demo/pi-ai";
import { buildActiveModelSnapshot, gatewayHost } from "../../src/session/active-model";

function fakeModel(overrides: Partial<Model> = {}): Model {
	return {
		id: "claude-opus-5",
		name: "Claude Opus 5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
		...overrides,
	} as Model;
}

describe("gatewayHost", () => {
	// The whole point of reporting a host rather than a URL: a base URL can carry userinfo, a
	// deployment id in the path, and an api-version in the query. None of that belongs in a doc the
	// model reads back to the user.
	it("keeps the host and discards credentials, path, and query", () => {
		expect(gatewayHost("https://user:secret@gw.example.com/v1?api-key=abc")).toBe("gw.example.com");
		expect(gatewayHost("https://f5ai.pd.f5net.com/anthropic")).toBe("f5ai.pd.f5net.com");
		expect(gatewayHost("https://gw.example.com:8443/v1")).toBe("gw.example.com:8443");
	});

	it("degrades to unknown rather than throwing", () => {
		expect(gatewayHost(undefined)).toBe("unknown");
		expect(gatewayHost("")).toBe("unknown");
		expect(gatewayHost("not a url")).toBe("unknown");
	});
});

describe("buildActiveModelSnapshot", () => {
	it("returns null when no model is resolved", () => {
		expect(buildActiveModelSnapshot({ model: undefined, resolutionSource: "config", roles: {} })).toBeNull();
	});

	it("captures id, name, provider, api, context window, and source", () => {
		const snapshot = buildActiveModelSnapshot({
			model: fakeModel(),
			resolutionSource: "launch-flag",
			roles: {},
		});

		expect(snapshot).toMatchObject({
			id: "claude-opus-5",
			name: "Claude Opus 5",
			provider: "anthropic",
			api: "anthropic-messages",
			gatewayHost: "api.anthropic.com",
			contextWindow: 200_000,
			resolutionSource: "launch-flag",
		});
		expect(snapshot?.resolutionSourceNote).toContain("--model");
	});

	// The credential test belongs at this layer: the renderer only ever receives an already-sanitized
	// gatewayHost, so asserting there could not catch a builder that leaked the base URL.
	it("never carries a credential, path, or query anywhere in the snapshot", () => {
		const snapshot = buildActiveModelSnapshot({
			model: fakeModel({ baseUrl: "https://user:secret@gw.example.com/v1?api-key=abc" }),
			resolutionSource: "config",
			roles: {},
		});

		const serialized = JSON.stringify(snapshot);
		expect(serialized).toContain("gw.example.com");
		expect(serialized).not.toContain("secret");
		expect(serialized).not.toContain("api-key");
		expect(serialized).not.toContain("/v1");
	});

	it("includes only the role models that are configured", () => {
		const none = buildActiveModelSnapshot({ model: fakeModel(), resolutionSource: "config", roles: {} });
		expect(none?.roles).toEqual({});

		const some = buildActiveModelSnapshot({
			model: fakeModel(),
			resolutionSource: "config",
			roles: { smol: "anthropic/claude-haiku-4-5", plan: "anthropic/claude-opus-5" },
		});
		expect(some?.roles).toEqual({ smol: "anthropic/claude-haiku-4-5", plan: "anthropic/claude-opus-5" });
	});

	it("glosses every resolution source", () => {
		for (const source of ["launch-flag", "config", "runtime-switch"] as const) {
			const snapshot = buildActiveModelSnapshot({ model: fakeModel(), resolutionSource: source, roles: {} });
			expect(snapshot?.resolutionSourceNote.length ?? 0).toBeGreaterThan(0);
		}
	});
});
