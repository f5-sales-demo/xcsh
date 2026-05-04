import { describe, expect, it } from "bun:test";
import { createContextEnv } from "../../src/services/context-env";

function makeSettings(env: Record<string, string>, sensitiveKeys?: string[]): any {
	return {
		get: (key: string) => {
			if (key === "bash.environment") return env;
			if (key === "f5xc.sensitiveKeys") return sensitiveKeys ?? []; // gitleaks:allow
			return undefined;
		},
	};
}

describe("createContextEnv", () => {
	describe("get()", () => {
		it("returns value for known key", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "example-ns" }));
			expect(ctx.get("F5XC_NAMESPACE")).toBe("example-ns");
		});

		it("returns undefined for missing key", () => {
			const ctx = createContextEnv(makeSettings({}));
			expect(ctx.get("F5XC_NAMESPACE")).toBeUndefined();
		});
	});

	describe("resolvePath()", () => {
		it("substitutes explicit params first", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "env-ns" }));
			const result = ctx.resolvePath("/api/{namespace}/resources", { namespace: "explicit-ns" });
			expect(result).toBe("/api/explicit-ns/resources");
		});

		it("falls back to F5XC_NAMESPACE for {namespace}", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "env-ns" }));
			const result = ctx.resolvePath("/api/{namespace}/resources");
			expect(result).toBe("/api/env-ns/resources");
		});

		it("resolves {name} from F5XC_NAME env var", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAME: "example-lb" }));
			const result = ctx.resolvePath("/api/{namespace}/{name}", { namespace: "default" });
			expect(result).toBe("/api/default/example-lb");
		});

		it("leaves unresolvable placeholders intact", () => {
			const ctx = createContextEnv(makeSettings({}));
			const result = ctx.resolvePath("/api/{namespace}/resources");
			expect(result).toBe("/api/{namespace}/resources");
		});

		it("resolves multiple placeholders", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "ns1" }));
			const result = ctx.resolvePath("/api/{namespace}/vhs/{vh_name}", { vh_name: "example-vh" });
			expect(result).toBe("/api/ns1/vhs/example-vh");
		});
	});

	describe("resolvePayloadVars()", () => {
		it("expands $F5XC_NAMESPACE in payload JSON", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "r-mordasiewicz" }));
			const payload = '{"metadata":{"namespace":"$F5XC_NAMESPACE","name":"test"}}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"metadata":{"namespace":"r-mordasiewicz","name":"test"}}');
		});

		it("expands multiple $F5XC_* references", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "example-ns", F5XC_LB_NAME: "example-lb" }));
			const payload = '{"ns":"$F5XC_NAMESPACE","lb":"$F5XC_LB_NAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"ns":"example-ns","lb":"example-lb"}');
		});

		it("leaves unresolvable $F5XC_* references unchanged", () => {
			const ctx = createContextEnv(makeSettings({}));
			const payload = '{"ns":"$F5XC_NAMESPACE"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"ns":"$F5XC_NAMESPACE"}');
		});

		it("returns unchanged payload when no $F5XC_ references", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "example-ns" }));
			const payload = '{"name":"test"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"name":"test"}');
		});

		it("refuses to expand $F5XC_API_TOKEN in payload", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_API_TOKEN: "real-secret-token" }));
			const payload = '{"token":"$F5XC_API_TOKEN"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"token":"$F5XC_API_TOKEN"}');
		});

		it("refuses to expand $F5XC_API_URL in payload", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_API_URL: "https://secret.com" }));
			const payload = '{"url":"$F5XC_API_URL"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"url":"$F5XC_API_URL"}');
		});

		it("allows expanding $F5XC_NAMESPACE in payload (not a credential)", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_NAMESPACE: "example-ns" }));
			const payload = '{"metadata":{"namespace":"$F5XC_NAMESPACE"}}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"metadata":{"namespace":"example-ns"}}');
		});

		it("refuses to expand keys matching SECRET_ENV_PATTERNS", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_MY_SECRET_KEY: "shh" }));
			const payload = '{"key":"$F5XC_MY_SECRET_KEY"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"key":"$F5XC_MY_SECRET_KEY"}');
		});

		it("refuses to expand explicit sensitiveKeys via options", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_USERNAME: "user" }), {
				sensitiveKeys: new Set(["F5XC_USERNAME"]),
			});
			const payload = '{"user":"$F5XC_USERNAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"user":"$F5XC_USERNAME"}');
		});

		it("refuses to expand sensitiveKeys from f5xc.sensitiveKeys settings (no options)", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_USERNAME: "user" }, ["F5XC_USERNAME"]));
			const payload = '{"user":"$F5XC_USERNAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"user":"$F5XC_USERNAME"}');
		});

		it("JSON-escapes substituted values containing special characters", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_DESC: 'value with "quotes" and \\backslash' }));
			const payload = '{"desc":"$F5XC_DESC"}';
			const result = ctx.resolvePayloadVars(payload);
			expect(() => JSON.parse(result)).not.toThrow();
			expect(JSON.parse(result).desc).toBe('value with "quotes" and \\backslash');
		});
	});

	describe("getNonSensitiveVars()", () => {
		it("excludes always-hidden keys", () => {
			const ctx = createContextEnv(
				makeSettings({
					F5XC_API_TOKEN: "secret",
					F5XC_API_URL: "https://example.com",
					F5XC_TENANT: "example-tenant",
					F5XC_NAMESPACE: "example-ns",
					F5XC_LB_NAME: "example-lb",
				}),
			);
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("F5XC_API_TOKEN");
			expect(vars).not.toHaveProperty("F5XC_API_URL");
			expect(vars).not.toHaveProperty("F5XC_TENANT");
			expect(vars).not.toHaveProperty("F5XC_NAMESPACE");
			expect(vars).toHaveProperty("F5XC_LB_NAME", "example-lb");
		});

		it("excludes keys matching SECRET_ENV_PATTERNS", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_MY_SECRET_KEY: "shhhh", F5XC_LB_NAME: "example-lb" }));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("F5XC_MY_SECRET_KEY");
			expect(vars).toHaveProperty("F5XC_LB_NAME");
		});

		it("excludes explicit sensitiveKeys via options", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_USERNAME: "user@example.com" }), {
				sensitiveKeys: new Set(["F5XC_USERNAME"]),
			});
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("F5XC_USERNAME");
		});

		it("excludes sensitiveKeys from f5xc.sensitiveKeys settings", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_USERNAME: "user@example.com" }, ["F5XC_USERNAME"]));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("F5XC_USERNAME");
		});

		it("returns empty object when no custom env vars", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_API_TOKEN: "tok", F5XC_API_URL: "https://example.com" }));
			expect(ctx.getNonSensitiveVars()).toEqual({});
		});

		it("only returns F5XC_ prefixed keys", () => {
			const ctx = createContextEnv(makeSettings({ F5XC_LB_NAME: "lb", HTTP_PROXY: "http://proxy" }));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).toHaveProperty("F5XC_LB_NAME");
			expect(vars).not.toHaveProperty("HTTP_PROXY");
		});
	});
});
