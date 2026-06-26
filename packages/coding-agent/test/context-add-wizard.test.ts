import { describe, expect, it } from "bun:test";
import {
	buildWizardContext,
	validateWizardName,
	validateWizardUrl,
} from "@f5-sales-demo/xcsh/modes/components/context-add-wizard";

const BASE_STATE = {
	url: "https://acme.console.ves.volterra.io",
	token: "tok-abc-1234",
	name: "prod",
	namespace: "system",
	username: "",
	password: "",
};

describe("validateWizardUrl", () => {
	it("accepts valid HTTPS URL", () => {
		expect(validateWizardUrl("https://acme.console.ves.volterra.io")).toBeNull();
	});

	it("rejects HTTP URL", () => {
		expect(validateWizardUrl("http://acme.console.ves.volterra.io")).not.toBeNull();
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
		expect(validateWizardUrl("https://acme.console.ves.volterra.io")).toBeNull();
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
		expect(ctx.apiUrl).toBe("https://acme.console.ves.volterra.io");
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
		const ctx = buildWizardContext({ ...BASE_STATE, password: "  pad ded  " });
		expect(ctx.env?.XCSH_CONSOLE_PASSWORD).toBe("  pad ded  ");
	});
});
