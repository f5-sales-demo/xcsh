import { describe, expect, it } from "bun:test";
import {
	buildWizardContext,
	normalizeWizardCredential,
	normalizeWizardUrl,
	validateWizardName,
	validateWizardUrl,
} from "../src/modes/components/context-add-wizard";
import { XCSH_API_TOKEN, XCSH_CONSOLE_PASSWORD, XCSH_USERNAME } from "../src/services/xcsh-env";

const BASE_STATE = {
	url: "https://example-corp.console.ves.volterra.io",
	token: "tok-abc-1234",
	name: "prod",
	namespace: "system",
	username: "",
	password: "",
};

describe("validateWizardUrl", () => {
	it("accepts valid HTTPS URL", () => {
		expect(validateWizardUrl("https://example-corp.console.ves.volterra.io")).toBeNull();
	});

	it("rejects HTTP URL", () => {
		expect(validateWizardUrl("http://example-corp.console.ves.volterra.io")).not.toBeNull();
	});

	it("rejects non-URL string", () => {
		expect(validateWizardUrl("not-a-url")).not.toBeNull();
	});

	it("rejects empty string", () => {
		expect(validateWizardUrl("")).not.toBeNull();
	});

	it("rejects incomplete hostname with trailing dot only", () => {
		expect(validateWizardUrl("https://api.")).not.toBeNull();
	});

	it("rejects single-label hostname without domain", () => {
		expect(validateWizardUrl("https://localhost")).not.toBeNull();
	});

	it("accepts valid multi-label hostname", () => {
		expect(validateWizardUrl("https://api.example.com")).toBeNull();
		expect(validateWizardUrl("https://example-corp.console.ves.volterra.io")).toBeNull();
	});
});

describe("wizard credential normalization", () => {
	it.each([
		["raw", "token-with-padding=", XCSH_API_TOKEN, "token-with-padding="],
		["opaque raw token ending in equals", "opaqueTokenEndingInEquals=", XCSH_API_TOKEN, "opaqueTokenEndingInEquals="],
		["opaque raw token with embedded equals", "opaque=token=value", XCSH_API_TOKEN, "opaque=token=value"],
		["assignment", "XCSH_API_TOKEN=token-with-padding=", XCSH_API_TOKEN, "token-with-padding="],
		["export", "export XCSH_API_TOKEN=token-with-padding=", XCSH_API_TOKEN, "token-with-padding="],
		["commented", "#XCSH_API_TOKEN=token-with-padding=", XCSH_API_TOKEN, "token-with-padding="],
		["double quoted", 'XCSH_API_TOKEN="token-with-padding="', XCSH_API_TOKEN, "token-with-padding="],
		["single quoted", "XCSH_CONSOLE_PASSWORD='safe value='", XCSH_CONSOLE_PASSWORD, "safe value="],
		["username assignment", "XCSH_USERNAME=user@example.test", XCSH_USERNAME, "user@example.test"],
	])("normalizes %s input", (_name, input, key, expected) => {
		expect(normalizeWizardCredential(input, key)).toBe(expected);
	});

	it.each([
		["wrong key", "XCSH_API_URL=https://tenant.example.test", XCSH_API_TOKEN],
		["wrong export key", "export XCSH_USERNAME=someone", XCSH_CONSOLE_PASSWORD],
		["multiline", "XCSH_API_TOKEN=one\ntwo", XCSH_API_TOKEN],
		["malformed assignment", "XCSH_API_TOKEN", XCSH_API_TOKEN],
		["unclosed quote", 'XCSH_API_TOKEN="unfinished', XCSH_API_TOKEN],
	])("rejects %s input", (_name, input, key) => {
		expect(normalizeWizardCredential(input, key)).toBeNull();
	});

	it("canonicalizes accepted tenant URLs to their HTTPS origin", () => {
		expect(normalizeWizardUrl("XCSH_API_URL=https://tenant.example.test/path?query=yes")).toBe(
			"https://tenant.example.test",
		);
	});
});

describe("validateWizardName", () => {
	it("accepts alphanumeric with hyphens and underscores", () => {
		expect(validateWizardName("my-context")).toBeNull();
		expect(validateWizardName("prod_01")).toBeNull();
	});

	it("rejects empty string", () => {
		expect(validateWizardName("")).not.toBeNull();
	});

	it("rejects strings over 64 characters", () => {
		expect(validateWizardName("a".repeat(65))).not.toBeNull();
	});

	it("rejects special characters", () => {
		expect(validateWizardName("my context")).not.toBeNull();
		expect(validateWizardName("prod@01")).not.toBeNull();
	});
});

describe("buildWizardContext", () => {
	it("builds the core fields and omits env when no credentials given", () => {
		const ctx = buildWizardContext(BASE_STATE);
		expect(ctx.name).toBe("prod");
		expect(ctx.apiUrl).toBe("https://example-corp.console.ves.volterra.io");
		expect(ctx.apiToken).toBe("tok-abc-1234");
		expect(ctx.defaultNamespace).toBe("system");
		expect(ctx.env).toBeUndefined();
		expect(ctx.sensitiveKeys).toBeUndefined();
	});

	it("stores username + console password as env and auto-marks the password sensitive", () => {
		const ctx = buildWizardContext({
			...BASE_STATE,
			username: "console-user@example.com",
			password: "s3cret-console-pass",
		});
		expect(ctx.env).toEqual({
			XCSH_USERNAME: "console-user@example.com",
			XCSH_CONSOLE_PASSWORD: "s3cret-console-pass",
		});
		expect(ctx.sensitiveKeys).toEqual(["XCSH_CONSOLE_PASSWORD"]);
	});

	it("stores username alone without marking anything sensitive", () => {
		const ctx = buildWizardContext({ ...BASE_STATE, username: "console-user@example.com" });
		expect(ctx.env).toEqual({ XCSH_USERNAME: "console-user@example.com" });
		expect(ctx.sensitiveKeys).toBeUndefined();
	});

	it("stores password alone and marks it sensitive", () => {
		const ctx = buildWizardContext({ ...BASE_STATE, password: "s3cret-console-pass" });
		expect(ctx.env).toEqual({ XCSH_CONSOLE_PASSWORD: "s3cret-console-pass" });
		expect(ctx.sensitiveKeys).toEqual(["XCSH_CONSOLE_PASSWORD"]);
	});

	it("preserves a password exactly (no trimming)", () => {
		const ctx = buildWizardContext({ ...BASE_STATE, password: "  padded  " });
		expect(ctx.env?.XCSH_CONSOLE_PASSWORD).toBe("  padded  ");
	});
});
