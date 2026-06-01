import { describe, expect, it } from "bun:test";
import { getFixableServices } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";

const allUndefined = {
	github: undefined,
	gitlab: undefined,
};

const allConnected = {
	github: { state: "connected" as const },
	gitlab: { state: "connected" as const, project: "g/r" },
};

describe("getFixableServices", () => {
	it("returns empty array when all providers are undefined (not installed)", () => {
		expect(getFixableServices(allUndefined)).toEqual([]);
	});

	it("returns empty array when all providers are connected", () => {
		expect(getFixableServices(allConnected)).toEqual([]);
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

	it("returns multiple fixes when multiple providers are fixable", () => {
		const result = getFixableServices({
			github: { state: "auth_error" },
			gitlab: { state: "auth_error" },
		});
		expect(result).toHaveLength(2);
		expect(result.map(s => s.name)).toEqual(["GitLab", "GitHub"]);
	});

	it("each fixable service has a recheck function", () => {
		const result = getFixableServices({ ...allConnected, github: { state: "auth_error" } });
		expect(result[0].recheck).toBeFunction();
	});
});
