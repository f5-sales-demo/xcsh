import { afterEach, describe, expect, it } from "bun:test";
import { clearConfigValueCache, resolveConfigValue, resolveHeaders } from "../../src/config/resolve-config-value";

describe("resolveConfigValue", () => {
	afterEach(() => {
		clearConfigValueCache();
		// Clean up any env vars we set during tests
		delete process.env.__TEST_RESOLVE_VALUE;
	});

	it("returns env var value when the env var is set", async () => {
		process.env.__TEST_RESOLVE_VALUE = "secret-key-123";
		const result = await resolveConfigValue("__TEST_RESOLVE_VALUE");
		expect(result).toBe("secret-key-123");
	});

	it("returns undefined for unresolved env var names instead of the literal name", async () => {
		// This is the core regression guard for issue #241:
		// LITELLM_API_KEY with no env var must NOT return "LITELLM_API_KEY" as a Bearer token.
		delete process.env.LITELLM_API_KEY;
		const result = await resolveConfigValue("LITELLM_API_KEY");
		expect(result).toBeUndefined();
	});

	it("returns undefined for other standard env var name patterns", async () => {
		delete process.env.OPENAI_API_KEY;
		delete process.env.GH_TOKEN;
		delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

		expect(await resolveConfigValue("OPENAI_API_KEY")).toBeUndefined();
		expect(await resolveConfigValue("GH_TOKEN")).toBeUndefined();
		expect(await resolveConfigValue("CLAUDE_CODE_OAUTH_TOKEN")).toBeUndefined();
	});

	it("returns a literal value that does not look like an env var name", async () => {
		// Actual API keys (lowercase, special chars, etc.) are treated as literals
		expect(await resolveConfigValue("sk-ant-abc123def456")).toBe("sk-ant-abc123def456");
		expect(await resolveConfigValue("my-custom-key")).toBe("my-custom-key");
		expect(await resolveConfigValue("f5_proxy_key_v2")).toBe("f5_proxy_key_v2"); // lowercase
	});

	it("returns undefined for a shell command that fails", async () => {
		const result = await resolveConfigValue("!false");
		expect(result).toBeUndefined();
	});

	it("resolves a shell command and caches the result", async () => {
		const result = await resolveConfigValue("!echo test-value");
		expect(result).toBe("test-value");

		// Second call should use cached value (same result)
		const cached = await resolveConfigValue("!echo test-value");
		expect(cached).toBe("test-value");
	});
});

describe("resolveHeaders", () => {
	afterEach(() => {
		clearConfigValueCache();
		delete process.env.__TEST_HEADER_VALUE;
	});

	it("returns undefined for undefined input", async () => {
		expect(await resolveHeaders(undefined)).toBeUndefined();
	});

	it("resolves header values through resolveConfigValue", async () => {
		process.env.__TEST_HEADER_VALUE = "Bearer my-token";
		const result = await resolveHeaders({ Authorization: "__TEST_HEADER_VALUE" });
		expect(result).toEqual({ Authorization: "Bearer my-token" });
	});

	it("omits headers with unresolved env var names", async () => {
		delete process.env.UNSET_TOKEN;
		const result = await resolveHeaders({
			"x-custom": "literal-value",
			Authorization: "UNSET_TOKEN",
		});
		// UNSET_TOKEN looks like an env var name, should be omitted
		expect(result).toEqual({ "x-custom": "literal-value" });
	});
});
