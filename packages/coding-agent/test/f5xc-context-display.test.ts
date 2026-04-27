import { describe, expect, it } from "bun:test";
import type { ContextStatus } from "@f5xc-salesdemos/xcsh/services/f5xc-context";
import { formatContextLabel } from "@f5xc-salesdemos/xcsh/services/f5xc-context-display";

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
		expect(formatContextLabel(status({ activeContextTenant: "acme", activeContextNamespace: "prod" }))).toBe(
			"acme:prod",
		);
	});

	it("falls back to context name when tenant is null", () => {
		expect(formatContextLabel(status({ activeContextName: "my-context" }))).toBe("my-context:default");
	});

	it("falls back to 'env' when both tenant and name are null", () => {
		expect(formatContextLabel(status())).toBe("env:default");
	});

	it("prefers tenant over name when both are present", () => {
		expect(formatContextLabel(status({ activeContextTenant: "acme", activeContextName: "my-context" }))).toBe(
			"acme:default",
		);
	});

	it("uses explicit namespace in place of the 'default' fallback", () => {
		expect(formatContextLabel(status({ activeContextNamespace: "staging" }))).toBe("env:staging");
	});
});
