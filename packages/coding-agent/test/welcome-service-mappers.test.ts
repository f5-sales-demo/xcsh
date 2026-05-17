import { describe, expect, it } from "bun:test";
import {
	classifyAwsError,
	classifyGcloudError,
	mapAwsStatus,
	mapAzureStatus,
	mapContextStatus,
	mapGcloudStatus,
	mapGitHubStatus,
	mapGitLabStatus,
	mapSalesforceStatus,
} from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";

describe("mapContextStatus", () => {
	it("no_context → unauthenticated with /context create hint", () => {
		const r = mapContextStatus({ state: "no_context" });
		expect(r.name).toBe("F5 XC Context");
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context create");
	});
	it("connected → connected", () => {
		const r = mapContextStatus({ state: "connected", name: "prod", latencyMs: 10 });
		expect(r.state).toBe("connected");
		expect(r.name).toBe("F5 XC Context");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with /context hint", () => {
		const r = mapContextStatus({ state: "auth_error", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
	it("offline with network errorClass → hint mentions connectivity", () => {
		const r = mapContextStatus({ state: "offline", name: "prod", errorClass: "network" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("network");
	});
	it("offline with url_not_found errorClass → hint mentions URL", () => {
		const r = mapContextStatus({ state: "offline", name: "prod", errorClass: "url_not_found" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("URL");
	});
	it("offline without errorClass → generic /context hint", () => {
		const r = mapContextStatus({ state: "offline", name: "prod" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("/context");
	});
});

describe("mapGitLabStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapGitLabStatus(undefined);
		expect(r.name).toBe("GitLab");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapGitLabStatus({ state: "connected", project: "group/repo" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with glab hint", () => {
		const r = mapGitLabStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("glab auth login");
	});
	it("not_configured → unauthenticated with glab hint", () => {
		const r = mapGitLabStatus({ state: "not_configured" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("glab auth login");
	});
	it("project_inaccessible → unauthenticated with project access hint", () => {
		const r = mapGitLabStatus({ state: "project_inaccessible", project: "g/r" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).not.toContain("glab auth login");
		expect(r.hint).toContain("project");
	});
});

describe("mapSalesforceStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapSalesforceStatus(undefined);
		expect(r.name).toBe("Salesforce");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapSalesforceStatus({ state: "connected", orgAlias: "SFDC" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with sf hint", () => {
		const r = mapSalesforceStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("sf org login web");
	});
	it("session_expired → unauthenticated with 'session expired' wording", () => {
		const r = mapSalesforceStatus({ state: "session_expired", orgAlias: "SFDC" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("session expired");
		expect(r.hint).toContain("sf org login web");
	});
	it("not_configured → unauthenticated with sf hint", () => {
		const r = mapSalesforceStatus({ state: "not_configured" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("sf org login web");
	});
});

describe("mapGitHubStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapGitHubStatus(undefined);
		expect(r.name).toBe("GitHub");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapGitHubStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with gh auth login hint", () => {
		const r = mapGitHubStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("gh auth login");
	});
});

describe("mapAzureStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapAzureStatus(undefined);
		expect(r.name).toBe("Azure");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapAzureStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with az login hint", () => {
		const r = mapAzureStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("az login --use-device-code");
	});
});

describe("mapAwsStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapAwsStatus(undefined);
		expect(r.name).toBe("AWS");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapAwsStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("sso_expired → unauthenticated with 'aws sso login' hint", () => {
		const r = mapAwsStatus({ state: "sso_expired" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("aws sso login");
	});
	it("not_configured → unauthenticated with 'aws configure' hint", () => {
		const r = mapAwsStatus({ state: "not_configured" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("aws configure");
	});
	it("profile_not_found → unauthenticated with profile hint", () => {
		const r = mapAwsStatus({ state: "profile_not_found" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("AWS_PROFILE");
	});
	it("auth_error (generic fallback) → unauthenticated with 'aws configure' hint", () => {
		const r = mapAwsStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("aws configure");
	});
	it("network_error → unauthenticated with connectivity hint", () => {
		const r = mapAwsStatus({ state: "network_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("network");
	});
});

describe("mapGcloudStatus", () => {
	it("undefined (not installed) → unavailable with 'not installed' hint", () => {
		const r = mapGcloudStatus(undefined);
		expect(r.name).toBe("Google Cloud");
		expect(r.state).toBe("unavailable");
		expect(r.hint).toBe("not installed");
	});
	it("connected → connected", () => {
		const r = mapGcloudStatus({ state: "connected" });
		expect(r.state).toBe("connected");
		expect(r.hint).toBeUndefined();
	});
	it("auth_error → unauthenticated with gcloud auth login hint", () => {
		const r = mapGcloudStatus({ state: "auth_error" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("gcloud auth login");
	});
	it("token_expired → unauthenticated with 'gcloud auth login' hint and expiry wording", () => {
		const r = mapGcloudStatus({ state: "token_expired" });
		expect(r.state).toBe("unauthenticated");
		expect(r.hint).toContain("expired");
		expect(r.hint).toContain("gcloud auth login");
	});
});

describe("classifyAwsError", () => {
	it("detects SSO token expiry", () => {
		expect(classifyAwsError("The SSO session associated with this profile has expired")).toBe("sso_expired");
	});
	it("detects SSO token missing", () => {
		expect(classifyAwsError("Error loading SSO Token: Token for Users-280469140135 does not exist")).toBe(
			"sso_expired",
		);
	});
	it("detects ExpiredTokenException", () => {
		expect(
			classifyAwsError("An error occurred (ExpiredTokenException) when calling the GetCallerIdentity operation"),
		).toBe("sso_expired");
	});
	it("detects ExpiredToken", () => {
		expect(classifyAwsError("An error occurred (ExpiredToken) when calling the GetCallerIdentity operation")).toBe(
			"sso_expired",
		);
	});
	it("detects SSO token refresh failure (newer CLI format)", () => {
		expect(
			classifyAwsError("aws: [ERROR]: Error when retrieving token from sso: Token has expired and refresh failed"),
		).toBe("sso_expired");
	});
	it("does not misclassify non-expiry sso token retrieval failures as sso_expired", () => {
		expect(classifyAwsError("aws: [ERROR]: Error when retrieving token from sso: connection reset")).toBe(
			"auth_error",
		);
	});
	it("detects no credentials", () => {
		expect(classifyAwsError("Unable to locate credentials")).toBe("not_configured");
	});
	it("detects profile not found", () => {
		expect(classifyAwsError("The config profile (Users-280469140135) could not be found")).toBe("profile_not_found");
	});
	it("detects InvalidClientTokenId", () => {
		expect(
			classifyAwsError("An error occurred (InvalidClientTokenId) when calling the GetCallerIdentity operation"),
		).toBe("auth_error");
	});
	it("detects network/connection errors", () => {
		expect(classifyAwsError("Could not connect to the endpoint URL")).toBe("network_error");
	});
	it("returns auth_error for unknown errors", () => {
		expect(classifyAwsError("something completely unexpected")).toBe("auth_error");
	});
});

describe("classifyGcloudError", () => {
	it("detects expired credentials", () => {
		expect(classifyGcloudError("does not have any valid credentials")).toBe("token_expired");
	});
	it("detects token refresh failure", () => {
		expect(
			classifyGcloudError(
				"ERROR: (gcloud.auth.print-access-token) There was a problem refreshing your current auth tokens",
			),
		).toBe("token_expired");
	});
	it("returns auth_error for no account", () => {
		expect(classifyGcloudError("You do not currently have an active account selected")).toBe("auth_error");
	});
	it("returns auth_error for unknown errors", () => {
		expect(classifyGcloudError("something unknown")).toBe("auth_error");
	});
});
