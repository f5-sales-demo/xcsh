import { afterEach, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "../src/models";
import { getAntigravityAuthHeaders } from "../src/providers/google-gemini-cli";
import { ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA, loginAntigravity } from "../src/utils/oauth/google-antigravity";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USER_INFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const LOAD_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ONBOARD_USER_URL = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser";
const originalFetch = global.fetch;

interface RecordedRequest {
	url: string;
	body: Record<string, unknown>;
}

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

async function withProjectEnvironment(
	primaryProject: string | undefined,
	fallbackProject: string | undefined,
	run: () => Promise<void>,
): Promise<void> {
	const originalPrimaryProject = Bun.env.GOOGLE_CLOUD_PROJECT;
	const originalFallbackProject = Bun.env.GOOGLE_CLOUD_PROJECT_ID;
	try {
		if (primaryProject === undefined) delete Bun.env.GOOGLE_CLOUD_PROJECT;
		else Bun.env.GOOGLE_CLOUD_PROJECT = primaryProject;
		if (fallbackProject === undefined) delete Bun.env.GOOGLE_CLOUD_PROJECT_ID;
		else Bun.env.GOOGLE_CLOUD_PROJECT_ID = fallbackProject;
		await run();
	} finally {
		if (originalPrimaryProject === undefined) delete Bun.env.GOOGLE_CLOUD_PROJECT;
		else Bun.env.GOOGLE_CLOUD_PROJECT = originalPrimaryProject;
		if (originalFallbackProject === undefined) delete Bun.env.GOOGLE_CLOUD_PROJECT_ID;
		else Bun.env.GOOGLE_CLOUD_PROJECT_ID = originalFallbackProject;
	}
}

async function runLogin(
	loadPayload: unknown,
	onboardPayload?: unknown,
): Promise<{ projectId: string | undefined; requests: RecordedRequest[] }> {
	const requests: RecordedRequest[] = [];
	global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : input.toString();
		if (url === TOKEN_URL) {
			return jsonResponse({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 });
		}
		if (url === USER_INFO_URL) {
			return jsonResponse({ email: "developer@example.com" });
		}
		if (url === LOAD_CODE_ASSIST_URL || url === ONBOARD_USER_URL) {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			requests.push({ url, body });
			if (url === LOAD_CODE_ASSIST_URL) return jsonResponse(loadPayload);
			if (onboardPayload !== undefined) return jsonResponse(onboardPayload);
		}
		throw new Error(`Unexpected URL: ${url}`);
	}) as unknown as typeof fetch;

	const credentials = await loginAntigravity({
		onManualCodeInput: async () => "authorization-code",
	});
	return { projectId: credentials.projectId, requests };
}

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("Google Antigravity auth alignment", () => {
	it("uses ANTIGRAVITY ideType in loadCodeAssist metadata payload", () => {
		expect(ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA).toEqual({
			ideType: "ANTIGRAVITY",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
		});
	});

	it("auth headers contain only User-Agent (no X-Goog-Api-Client or Client-Metadata)", () => {
		// Verified from Antigravity binary (kae.w / kae.y in main.js):
		// the real client sends only Content-Type + User-Agent for all API calls.
		// Product identification (ideType, ideName) goes in the protobuf request body.
		const headers = getAntigravityAuthHeaders();
		expect(Object.keys(headers)).toEqual(["User-Agent"]);
		expect(headers["User-Agent"]).toMatch(/^antigravity\//);
	});

	it("bundles Gemini 3.6 Flash High as an Antigravity model", () => {
		expect(getBundledModel("google-antigravity", "gemini-3.6-flash-high")).toMatchObject({
			id: "gemini-3.6-flash-high",
			provider: "google-antigravity",
			api: "google-gemini-cli",
			reasoning: true,
			thinking: {
				mode: "google-level",
				minLevel: "minimal",
				maxLevel: "high",
			},
		});
	});

	it("prefers GOOGLE_CLOUD_PROJECT and retains it when discovery returns another project", async () => {
		await withProjectEnvironment("primary-enterprise-project", "fallback-enterprise-project", async () => {
			const { projectId, requests } = await runLogin({
				cloudaicompanionProject: { id: "generated-free-tier-project" },
			});

			expect(projectId).toBe("primary-enterprise-project");
			expect(requests).toEqual([
				{
					url: LOAD_CODE_ASSIST_URL,
					body: {
						cloudaicompanionProject: "primary-enterprise-project",
						metadata: {
							...ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
							duetProject: "primary-enterprise-project",
						},
					},
				},
			]);
		});
	});

	it("uses GOOGLE_CLOUD_PROJECT_ID when the primary project variable is absent", async () => {
		await withProjectEnvironment(undefined, "fallback-enterprise-project", async () => {
			const { projectId, requests } = await runLogin({
				cloudaicompanionProject: "generated-free-tier-project",
			});

			expect(projectId).toBe("fallback-enterprise-project");
			expect(requests[0]).toEqual({
				url: LOAD_CODE_ASSIST_URL,
				body: {
					cloudaicompanionProject: "fallback-enterprise-project",
					metadata: {
						...ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
						duetProject: "fallback-enterprise-project",
					},
				},
			});
		});
	});

	it("includes the configured enterprise project when onboarding is required", async () => {
		await withProjectEnvironment("primary-enterprise-project", undefined, async () => {
			const { projectId, requests } = await runLogin(
				{
					allowedTiers: [{ id: "standard-tier", isDefault: true }],
				},
				{
					done: true,
					response: { cloudaicompanionProject: { id: "generated-free-tier-project" } },
				},
			);

			expect(projectId).toBe("primary-enterprise-project");
			expect(requests).toEqual([
				{
					url: LOAD_CODE_ASSIST_URL,
					body: {
						cloudaicompanionProject: "primary-enterprise-project",
						metadata: {
							...ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
							duetProject: "primary-enterprise-project",
						},
					},
				},
				{
					url: ONBOARD_USER_URL,
					body: {
						tierId: "standard-tier",
						cloudaicompanionProject: "primary-enterprise-project",
						metadata: {
							...ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
							duetProject: "primary-enterprise-project",
						},
					},
				},
			]);
		});
	});

	it("preserves automatic project onboarding when no project variable is configured", async () => {
		await withProjectEnvironment(undefined, undefined, async () => {
			const { projectId, requests } = await runLogin(
				{
					allowedTiers: [{ id: "free-tier", isDefault: true }],
				},
				{
					done: true,
					response: { cloudaicompanionProject: "generated-free-tier-project" },
				},
			);

			expect(projectId).toBe("generated-free-tier-project");
			expect(requests).toEqual([
				{
					url: LOAD_CODE_ASSIST_URL,
					body: { metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA },
				},
				{
					url: ONBOARD_USER_URL,
					body: {
						tierId: "free-tier",
						metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
					},
				},
			]);
		});
	});
});
