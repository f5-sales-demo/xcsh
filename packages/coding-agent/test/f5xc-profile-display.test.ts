import { describe, expect, it } from "bun:test";
import type { ProfileStatus } from "@f5xc-salesdemos/xcsh/services/f5xc-profile";
import { formatProfileLabel } from "@f5xc-salesdemos/xcsh/services/f5xc-profile-display";

function status(overrides: Partial<ProfileStatus> = {}): ProfileStatus {
	return {
		activeProfileName: null,
		activeProfileUrl: null,
		activeProfileTenant: null,
		activeProfileNamespace: null,
		credentialSource: "none",
		authStatus: "unknown",
		isConfigured: false,
		...overrides,
	};
}

describe("formatProfileLabel", () => {
	it("uses tenant and namespace when both are present", () => {
		expect(formatProfileLabel(status({ activeProfileTenant: "acme", activeProfileNamespace: "prod" }))).toBe(
			"acme:prod",
		);
	});

	it("falls back to profile name when tenant is null", () => {
		expect(formatProfileLabel(status({ activeProfileName: "my-profile" }))).toBe("my-profile:default");
	});

	it("falls back to 'env' when both tenant and name are null", () => {
		expect(formatProfileLabel(status())).toBe("env:default");
	});

	it("prefers tenant over name when both are present", () => {
		expect(formatProfileLabel(status({ activeProfileTenant: "acme", activeProfileName: "my-profile" }))).toBe(
			"acme:default",
		);
	});

	it("uses explicit namespace in place of the 'default' fallback", () => {
		expect(formatProfileLabel(status({ activeProfileNamespace: "staging" }))).toBe("env:staging");
	});
});
