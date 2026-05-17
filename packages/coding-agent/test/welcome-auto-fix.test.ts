import { describe, expect, it } from "bun:test";
import { getFixableServices } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";

const allUndefined = {
	aws: undefined,
	azure: undefined,
	gcloud: undefined,
	github: undefined,
	gitlab: undefined,
	salesforce: undefined,
};

const allConnected = {
	aws: { state: "connected" as const },
	azure: { state: "connected" as const },
	gcloud: { state: "connected" as const },
	github: { state: "connected" as const },
	gitlab: { state: "connected" as const, project: "g/r" },
	salesforce: { state: "connected" as const, orgAlias: "prod" },
};

describe("getFixableServices", () => {
	it("returns empty array when all providers are undefined (not installed)", () => {
		expect(getFixableServices(allUndefined)).toEqual([]);
	});

	it("returns empty array when all providers are connected", () => {
		expect(getFixableServices(allConnected)).toEqual([]);
	});

	it("returns AWS fix for sso_expired", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "sso_expired" } });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("AWS");
		expect(result[0].command).toEqual(["aws", "sso", "login"]);
		expect(result[0].prompt).toContain("SSO");
	});

	it("does not return AWS fix for not_configured", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "not_configured" } });
		expect(result).toEqual([]);
	});

	it("does not return AWS fix for profile_not_found", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "profile_not_found" } });
		expect(result).toEqual([]);
	});

	it("does not return AWS fix for network_error", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "network_error" } });
		expect(result).toEqual([]);
	});

	it("does not return AWS fix for auth_error (generic)", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "auth_error" } });
		expect(result).toEqual([]);
	});

	it("returns Azure fix for auth_error", () => {
		const result = getFixableServices({ ...allConnected, azure: { state: "auth_error" } });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Azure");
		expect(result[0].command).toEqual(["az", "login", "--use-device-code"]);
	});

	it("returns GCloud fix for token_expired", () => {
		const result = getFixableServices({ ...allConnected, gcloud: { state: "token_expired" } });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Google Cloud");
		expect(result[0].command).toEqual(["gcloud", "auth", "login"]);
	});

	it("does not return GCloud fix for auth_error (no account)", () => {
		const result = getFixableServices({ ...allConnected, gcloud: { state: "auth_error" } });
		expect(result).toEqual([]);
	});

	it("returns GitHub fix for auth_error", () => {
		const result = getFixableServices({ ...allConnected, github: { state: "auth_error" } });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("GitHub");
		expect(result[0].command).toEqual(["gh", "auth", "login"]);
	});

	it("returns GitLab fix for auth_error", () => {
		const result = getFixableServices({ ...allConnected, gitlab: { state: "auth_error" } });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("GitLab");
		expect(result[0].command).toEqual(["glab", "auth", "login"]);
	});

	it("does not return GitLab fix for not_configured (already authenticated, project issue)", () => {
		const result = getFixableServices({ ...allConnected, gitlab: { state: "not_configured" } });
		expect(result).toEqual([]);
	});

	it("does not return GitLab fix for project_inaccessible", () => {
		const result = getFixableServices({
			...allConnected,
			gitlab: { state: "project_inaccessible", project: "g/r" },
		});
		expect(result).toEqual([]);
	});

	it("returns Salesforce fix for session_expired", () => {
		const result = getFixableServices({
			...allConnected,
			salesforce: { state: "session_expired", orgAlias: "prod" },
		});
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Salesforce");
		expect(result[0].command).toEqual(["sf", "org", "login", "web"]);
	});

	it("does not return Salesforce fix for not_configured", () => {
		const result = getFixableServices({ ...allConnected, salesforce: { state: "not_configured" } });
		expect(result).toEqual([]);
	});

	it("returns multiple fixes when multiple providers are fixable", () => {
		const result = getFixableServices({
			aws: { state: "sso_expired" },
			azure: { state: "auth_error" },
			gcloud: { state: "token_expired" },
			github: { state: "connected" },
			gitlab: { state: "connected", project: "g/r" },
			salesforce: { state: "connected", orgAlias: "prod" },
		});
		expect(result).toHaveLength(3);
		expect(result.map(s => s.name)).toEqual(["Azure", "AWS", "Google Cloud"]);
	});

	it("each fixable service has a recheck function", () => {
		const result = getFixableServices({ ...allConnected, aws: { state: "sso_expired" } });
		expect(result[0].recheck).toBeFunction();
	});
});
