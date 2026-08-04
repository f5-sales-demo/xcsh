import { describe, expect, test } from "bun:test";
import { GatewayConfigError, MemoryGatewayConfigStore, normalizeGatewayConfig } from "../src/core/gateway/config";

describe("normalizeGatewayConfig", () => {
	test("accepts a minimal valid input and leaves model selection to xcsh", () => {
		const cfg = normalizeGatewayConfig({ baseUrl: "https://gateway.example.com/v1", token: "sk-abc" });
		expect(cfg.baseUrl).toBe("https://gateway.example.com");
		expect(cfg.token).toBe("sk-abc");
		expect(cfg).not.toHaveProperty("model");
	});

	test("normalizes provider-specific paths to the gateway root", () => {
		expect(normalizeGatewayConfig({ baseUrl: "  https://gw.example/v1/  ", token: " t " }).baseUrl).toBe(
			"https://gw.example",
		);
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example/openai/v1", token: "t" }).baseUrl).toBe(
			"https://gw.example",
		);
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example/anthropic", token: "t" }).baseUrl).toBe(
			"https://gw.example",
		);
		expect(
			normalizeGatewayConfig({ baseUrl: "https://gw.example:8443/api/v1?legacy=true#old", token: "t" }).baseUrl,
		).toBe("https://gw.example:8443");
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example", token: "  tok  " }).token).toBe("tok");
	});

	test("honours an explicit model", () => {
		expect(
			normalizeGatewayConfig({ baseUrl: "https://gw.example/v1", token: "t", model: " custom/model " }).model,
		).toBe("custom/model");
	});

	test("treats a whitespace-only model as omitted", () => {
		expect(normalizeGatewayConfig({ baseUrl: "https://gw.example/v1", token: "t", model: "   " })).not.toHaveProperty(
			"model",
		);
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
