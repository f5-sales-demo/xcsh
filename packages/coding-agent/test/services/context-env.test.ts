import { describe, expect, it } from "bun:test";
import { createContextEnv } from "../../src/services/context-env";

function makeSettings(env: Record<string, string>, sensitiveKeys?: string[]): any {
	return {
		get: (key: string) => {
			if (key === "bash.environment") return env;
			if (key === "xcsh.sensitiveKeys") return sensitiveKeys ?? []; // gitleaks:allow
			return undefined;
		},
	};
}

describe("createContextEnv", () => {
	describe("get()", () => {
		it("returns value for known key", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "example-ns" }));
			expect(ctx.get("XCSH_NAMESPACE")).toBe("example-ns");
		});

		it("returns undefined for missing key", () => {
			const ctx = createContextEnv(makeSettings({}));
			expect(ctx.get("XCSH_NAMESPACE")).toBeUndefined();
		});
	});

	describe("resolvePath()", () => {
		it("substitutes explicit params first", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "env-ns" }));
			const result = ctx.resolvePath("/api/{namespace}/resources", { namespace: "explicit-ns" });
			expect(result).toBe("/api/explicit-ns/resources");
		});

		it("falls back to XCSH_NAMESPACE for {namespace}", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "env-ns" }));
			const result = ctx.resolvePath("/api/{namespace}/resources");
			expect(result).toBe("/api/env-ns/resources");
		});

		it("resolves {name} from XCSH_NAME env var", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAME: "example-lb" }));
			const result = ctx.resolvePath("/api/{namespace}/{name}", { namespace: "default" });
			expect(result).toBe("/api/default/example-lb");
		});

		it("leaves unresolvable placeholders intact", () => {
			const ctx = createContextEnv(makeSettings({}));
			const result = ctx.resolvePath("/api/{nonexistent_placeholder}/resources");
			expect(result).toBe("/api/{nonexistent_placeholder}/resources");
		});

		it("resolves multiple placeholders", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "ns1" }));
			const result = ctx.resolvePath("/api/{namespace}/vhs/{vh_name}", { vh_name: "example-vh" });
			expect(result).toBe("/api/ns1/vhs/example-vh");
		});

		it("falls back to process.env when bash.environment is empty", () => {
			const original = process.env.XCSH_NAMESPACE;
			process.env.XCSH_NAMESPACE = "from-process-env";
			try {
				const ctx = createContextEnv(makeSettings({}));
				const result = ctx.resolvePath("/api/{namespace}/resources");
				expect(result).toBe("/api/from-process-env/resources");
			} finally {
				if (original) process.env.XCSH_NAMESPACE = original;
				else delete process.env.XCSH_NAMESPACE;
			}
		});

		it("does not re-resolve explicit param values containing {placeholder} syntax", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_OTHER: "leaked" }));
			const result = ctx.resolvePath("/api/{namespace}/resource", { namespace: "{other}" });
			// The value "{other}" should be inserted literally — NOT re-resolved to "leaked"
			expect(result).toBe("/api/{other}/resource");
		});
	});

	describe("resolvePayloadVars()", () => {
		it("expands $XCSH_NAMESPACE in payload JSON", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "example-namespace" }));
			const payload = '{"metadata":{"namespace":"$XCSH_NAMESPACE","name":"test"}}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"metadata":{"namespace":"example-namespace","name":"test"}}');
		});

		it("expands multiple $XCSH_* references", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "example-ns", XCSH_LB_NAME: "example-lb" }));
			const payload = '{"ns":"$XCSH_NAMESPACE","lb":"$XCSH_LB_NAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"ns":"example-ns","lb":"example-lb"}');
		});

		it("leaves unresolvable $XCSH_* references unchanged", () => {
			const ctx = createContextEnv(makeSettings({}));
			const payload = '{"val":"$XCSH_NONEXISTENT_VAR"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"val":"$XCSH_NONEXISTENT_VAR"}');
		});

		it("returns unchanged payload when no $XCSH_ references", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "example-ns" }));
			const payload = '{"name":"test"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"name":"test"}');
		});

		it("refuses to expand $XCSH_API_TOKEN in payload", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_API_TOKEN: "real-secret-token" }));
			const payload = '{"token":"$XCSH_API_TOKEN"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"token":"$XCSH_API_TOKEN"}');
		});

		it("refuses to expand $XCSH_API_URL in payload", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_API_URL: "https://secret.com" }));
			const payload = '{"url":"$XCSH_API_URL"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"url":"$XCSH_API_URL"}');
		});

		it("allows expanding $XCSH_NAMESPACE in payload (not a credential)", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_NAMESPACE: "example-ns" }));
			const payload = '{"metadata":{"namespace":"$XCSH_NAMESPACE"}}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"metadata":{"namespace":"example-ns"}}');
		});

		it("refuses to expand keys matching SECRET_ENV_PATTERNS", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_MY_SECRET_KEY: "shh" }));
			const payload = '{"key":"$XCSH_MY_SECRET_KEY"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"key":"$XCSH_MY_SECRET_KEY"}');
		});

		it("refuses to expand explicit sensitiveKeys via options", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_USERNAME: "user" }), {
				sensitiveKeys: new Set(["XCSH_USERNAME"]),
			});
			const payload = '{"user":"$XCSH_USERNAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"user":"$XCSH_USERNAME"}');
		});

		it("refuses to expand sensitiveKeys from xcsh.sensitiveKeys settings (no options)", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_USERNAME: "user" }, ["XCSH_USERNAME"]));
			const payload = '{"user":"$XCSH_USERNAME"}';
			expect(ctx.resolvePayloadVars(payload)).toBe('{"user":"$XCSH_USERNAME"}');
		});

		it("JSON-escapes substituted values containing special characters", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_DESC: 'value with "quotes" and \\backslash' }));
			const payload = '{"desc":"$XCSH_DESC"}';
			const result = ctx.resolvePayloadVars(payload);
			expect(() => JSON.parse(result)).not.toThrow();
			expect(JSON.parse(result).desc).toBe('value with "quotes" and \\backslash');
		});
	});

	describe("getNonSensitiveVars()", () => {
		it("excludes always-hidden keys", () => {
			const ctx = createContextEnv(
				makeSettings({
					XCSH_API_TOKEN: "secret",
					XCSH_API_URL: "https://example.com",
					XCSH_TENANT: "example-tenant",
					XCSH_NAMESPACE: "example-ns",
					XCSH_LB_NAME: "example-lb",
				}),
			);
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("XCSH_API_TOKEN");
			expect(vars).not.toHaveProperty("XCSH_API_URL");
			expect(vars).not.toHaveProperty("XCSH_TENANT");
			expect(vars).not.toHaveProperty("XCSH_NAMESPACE");
			expect(vars).toHaveProperty("XCSH_LB_NAME", "example-lb");
		});

		it("excludes keys matching SECRET_ENV_PATTERNS", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_MY_SECRET_KEY: "shhhh", XCSH_LB_NAME: "example-lb" }));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("XCSH_MY_SECRET_KEY");
			expect(vars).toHaveProperty("XCSH_LB_NAME");
		});

		it("excludes explicit sensitiveKeys via options", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_USERNAME: "user@example.com" }), {
				sensitiveKeys: new Set(["XCSH_USERNAME"]),
			});
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("XCSH_USERNAME");
		});

		it("excludes sensitiveKeys from xcsh.sensitiveKeys settings", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_USERNAME: "user@example.com" }, ["XCSH_USERNAME"]));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).not.toHaveProperty("XCSH_USERNAME");
		});

		it("returns empty object when no custom env vars", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_API_TOKEN: "tok", XCSH_API_URL: "https://example.com" }));
			expect(ctx.getNonSensitiveVars()).toEqual({});
		});

		it("only returns XCSH_ prefixed keys", () => {
			const ctx = createContextEnv(makeSettings({ XCSH_LB_NAME: "lb", HTTP_PROXY: "http://proxy" }));
			const vars = ctx.getNonSensitiveVars();
			expect(vars).toHaveProperty("XCSH_LB_NAME");
			expect(vars).not.toHaveProperty("HTTP_PROXY");
		});
	});
});
