import { describe, expect, it } from "bun:test";
import type { ContextStatus } from "../src/services/xcsh-context";
import { formatContextLabel } from "../src/services/xcsh-context-display";

function status(overrides: Partial<ContextStatus> = {}): ContextStatus {
	return {
		activeContextName: null,
		activeContextUrl: null,
		activeContextTenant: null,
		activeContextNamespace: null,
		credentialSource: "none",
		authStatus: "unknown",
		isConfigured: false,
		tokenHealth: "ok",
		...overrides,
	};
}

describe("formatContextLabel", () => {
	it("uses tenant and namespace when both are present", () => {
		expect(formatContextLabel(status({ activeContextTenant: "example-corp", activeContextNamespace: "prod" }))).toBe(
			"example-corp:prod",
		);
	});

	it("falls back to context name when tenant is null", () => {
		expect(formatContextLabel(status({ activeContextName: "my-context" }))).toBe("my-context:default");
	});

	it("falls back to 'env' when both tenant and name are null", () => {
		expect(formatContextLabel(status())).toBe("env:default");
	});

	it("prefers tenant over name when both are present", () => {
		expect(formatContextLabel(status({ activeContextTenant: "example-corp", activeContextName: "my-context" }))).toBe(
			"example-corp:default",
		);
	});

	it("uses explicit namespace in place of the 'default' fallback", () => {
		expect(formatContextLabel(status({ activeContextNamespace: "staging" }))).toBe("env:staging");
	});

	it("appends warning icon when token is expiring", () => {
		expect(
			formatContextLabel(
				status({ activeContextTenant: "example-corp", activeContextNamespace: "prod", tokenHealth: "expiring" }),
			),
		).toBe("example-corp:prod ⚠");
	});

	it("appends warning icon when token is expired", () => {
		expect(
			formatContextLabel(
				status({ activeContextTenant: "example-corp", activeContextNamespace: "prod", tokenHealth: "expired" }),
			),
		).toBe("example-corp:prod ⚠");
	});

	it("no suffix when token health is ok", () => {
		expect(
			formatContextLabel(
				status({ activeContextTenant: "example-corp", activeContextNamespace: "prod", tokenHealth: "ok" }),
			),
		).toBe("example-corp:prod");
	});
});
