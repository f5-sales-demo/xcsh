import { describe, expect, test } from "bun:test";
import {
	DEFAULT_GATEWAY_MODEL,
	GatewayConfigError,
	MemoryGatewayConfigStore,
	normalizeGatewayConfig,
} from "../src/core/gateway/config";

describe("normalizeGatewayConfig", () => {
	test("accepts a minimal valid input and applies the default model", () => {
		const cfg = normalizeGatewayConfig({ baseUrl: "https://f5ai.pd.f5net.com/anthropic", token: "sk-abc" });
		expect(cfg.baseUrl).toBe("https://f5ai.pd.f5net.com/anthropic");
		expect(cfg.token).toBe("sk-abc");
		expect(cfg.model).toBe(DEFAULT_GATEWAY_MODEL);
	});

	test("trims whitespace and strips a trailing slash / stray /v1[/messages]", () => {
		expect(normalizeGatewayConfig({ baseUrl: "  https://gw.example/anthropic/  ", token: " t " }).baseUrl).toBe(
			"https://gw.example/anthropic",
		);
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic/v1", token: "t" }).baseUrl).toBe(
			"https://gw.example/anthropic",
		);
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic/v1/messages", token: "t" }).baseUrl).toBe(
			"https://gw.example/anthropic",
		);
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example", token: "  tok  " }).token).toBe("tok");
	});

	test("honours an explicit model", () => {
		expect(
			normalizeGatewayConfig({ baseUrl: "https://gw.example", token: "t", model: "claude-sonnet-5" }).model,
		).toBe("claude-sonnet-5");
	});

	test("rejects non-https, empty, or malformed input", () => {
		expect(() => normalizeGatewayConfig({ baseUrl: "http://gw.example", token: "t" })).toThrow(GatewayConfigError);
		expect(() => normalizeGatewayConfig({ baseUrl: "  ", token: "t" })).toThrow(GatewayConfigError);
		expect(() => normalizeGatewayConfig({ baseUrl: "https://gw.example", token: "  " })).toThrow(GatewayConfigError);
		expect(() => normalizeGatewayConfig({ baseUrl: "not a url", token: "t" })).toThrow(GatewayConfigError);
		expect(() => normalizeGatewayConfig({ baseUrl: "https://", token: "t" })).toThrow(GatewayConfigError);
	});
});

describe("MemoryGatewayConfigStore", () => {
	test("load→null before save; save→load round-trips; clear removes", () => {
		const store = new MemoryGatewayConfigStore();
		expect(store.load()).toBeNull();
		const cfg = normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "t" });
		store.save(cfg);
		expect(store.load()).toEqual(cfg);
		store.clear();
		expect(store.load()).toBeNull();
	});
});
