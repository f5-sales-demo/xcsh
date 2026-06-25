import { describe, expect, it } from "bun:test";
import {
	type ContextOverrides,
	isInlineContext,
	isPointerContext,
	mergePointerOverrides,
	validateLocalContextFile,
	type XCSHContextData,
} from "../src/xcsh-context-resolver";

describe("isPointerContext", () => {
	it("returns true when 'context' field is present and no 'apiUrl'", () => {
		const data = { context: "prod-tenant", overrides: { defaultNamespace: "ns" } };
		expect(isPointerContext(data)).toBe(true);
	});

	it("returns false when 'apiUrl' is present", () => {
		const data = { apiUrl: "https://example.com", apiToken: "tok" };
		expect(isPointerContext(data)).toBe(false);
	});

	it("returns false for null/undefined", () => {
		expect(isPointerContext(null)).toBe(false);
		expect(isPointerContext(undefined)).toBe(false);
	});
});

describe("isInlineContext", () => {
	it("returns true when 'apiUrl' is present", () => {
		const data = { name: "test", apiUrl: "https://x.com", apiToken: "t", defaultNamespace: "ns" };
		expect(isInlineContext(data)).toBe(true);
	});

	it("returns false when only 'context' field is present", () => {
		const data = { context: "prod" };
		expect(isInlineContext(data)).toBe(false);
	});
});

describe("validateLocalContextFile", () => {
	it("accepts a valid pointer context", () => {
		const data = { context: "prod" };
		expect(validateLocalContextFile(data)).toEqual({ valid: true });
	});

	it("accepts a valid inline context", () => {
		const data = { name: "x", apiUrl: "https://x.com", apiToken: "t", defaultNamespace: "ns" };
		expect(validateLocalContextFile(data)).toEqual({ valid: true });
	});

	it("rejects when both 'context' and 'apiUrl' are present", () => {
		const data = { context: "prod", apiUrl: "https://x.com" };
		const result = validateLocalContextFile(data);
		expect(result.valid).toBe(false);
		expect(result.error).toContain("both");
	});

	it("rejects when neither 'context' nor 'apiUrl' is present", () => {
		const data = { name: "orphan" };
		const result = validateLocalContextFile(data);
		expect(result.valid).toBe(false);
	});
});

describe("mergePointerOverrides", () => {
	const base: XCSHContextData = {
		name: "prod",
		apiUrl: "https://prod.example.com",
		apiToken: "token123",
		defaultNamespace: "system",
		env: { EXISTING: "value" },
	};

	it("overrides defaultNamespace", () => {
		const overrides: ContextOverrides = { defaultNamespace: "my-ns" };
		const merged = mergePointerOverrides(base, overrides);
		expect(merged.defaultNamespace).toBe("my-ns");
		expect(merged.apiUrl).toBe(base.apiUrl);
		expect(merged.apiToken).toBe(base.apiToken);
	});

	it("merges env vars (does not replace)", () => {
		const overrides: ContextOverrides = { env: { NEW_VAR: "new" } };
		const merged = mergePointerOverrides(base, overrides);
		expect(merged.env).toEqual({ EXISTING: "value", NEW_VAR: "new" });
	});

	it("override env wins on conflict", () => {
		const overrides: ContextOverrides = { env: { EXISTING: "overridden" } };
		const merged = mergePointerOverrides(base, overrides);
		expect(merged.env?.EXISTING).toBe("overridden");
	});

	it("returns base unchanged when overrides is empty", () => {
		const merged = mergePointerOverrides(base, {});
		expect(merged).toEqual(base);
	});
});
