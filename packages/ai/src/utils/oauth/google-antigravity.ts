/**
 * Antigravity OAuth flow (Gemini 3, Claude, GPT-OSS via Google Cloud)
 * Uses different OAuth credentials than google-gemini-cli for access to additional models.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { $env } from "@f5-sales-demo/pi-utils";
import { getAntigravityAuthHeaders } from "../../providers/google-gemini-cli";
import { OAuthCallbackFlow } from "./callback-server";
import type { OAuthController, OAuthCredentials } from "./types";

const decode = (s: string) => atob(s);
const CLIENT_ID = decode(
	"MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const CLIENT_SECRET = decode("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";

const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_CODE_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const TIER_LEGACY = "legacy-tier";
const PROJECT_ONBOARD_MAX_ATTEMPTS = 5;
const PROJECT_ONBOARD_INTERVAL_MS = 2000;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ANTIGRAVITY_CLI_TOKEN_PATH = join(homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token");

interface LoadCodeAssistPayload {
	cloudaicompanionProject?: string | { id?: string };
	currentTier?: { id?: string };
	allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
}

interface LongRunningOperationResponse {
	done?: boolean;
	response?: {
		cloudaicompanionProject?: string | { id?: string };
	};
}

export const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA = Object.freeze({
	ideType: "ANTIGRAVITY",
	platform: "PLATFORM_UNSPECIFIED",
	pluginType: "GEMINI",
});

interface AntigravityProjectRequest {
	cloudaicompanionProject?: string;
	metadata: typeof ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA & { duetProject?: string };
}

interface ProjectEnvironment {
	GOOGLE_CLOUD_PROJECT?: string;
	GOOGLE_CLOUD_PROJECT_ID?: string;
}

interface GcloudProjectCommandResult {
	exitCode: number;
	stdout: string;
}

type GcloudProjectCommand = () => Promise<GcloudProjectCommandResult>;

export interface AntigravityProjectSources {
	environment?: ProjectEnvironment;
	readAntigravityProjectId?: () => Promise<string | undefined>;
	readGcloudProjectId?: () => Promise<string | undefined>;
}

export interface AntigravityLoginOptions {
	projectSources?: AntigravityProjectSources;
}

function normalizeProjectId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const projectId = value.trim();
	return PROJECT_ID_PATTERN.test(projectId) ? projectId : undefined;
}

export async function readAntigravityCliProjectId(
	metadataPath = ANTIGRAVITY_CLI_TOKEN_PATH,
): Promise<string | undefined> {
	try {
		const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
		if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
		return normalizeProjectId((metadata as { project_id?: unknown }).project_id);
	} catch {
		return undefined;
	}
}

async function runGcloudProjectCommand(): Promise<GcloudProjectCommandResult> {
	const subprocess = Bun.spawn(["gcloud", "config", "get-value", "project"], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const [stdout, exitCode] = await Promise.all([new Response(subprocess.stdout).text(), subprocess.exited]);
	return { exitCode, stdout };
}

export async function readGcloudProjectId(
	runCommand: GcloudProjectCommand = runGcloudProjectCommand,
): Promise<string | undefined> {
	try {
		const result = await runCommand();
		if (result.exitCode !== 0) return undefined;
		return normalizeProjectId(result.stdout);
	} catch {
		return undefined;
	}
}

async function readExternalProjectId(source: () => Promise<string | undefined>): Promise<string | undefined> {
	try {
		return normalizeProjectId(await source());
	} catch {
		return undefined;
	}
}

export async function resolveAntigravityProjectId(
	ctrl: OAuthController,
	sources: AntigravityProjectSources = {},
): Promise<string | undefined> {
	const environment = sources.environment ?? {
		GOOGLE_CLOUD_PROJECT: $env.GOOGLE_CLOUD_PROJECT,
		GOOGLE_CLOUD_PROJECT_ID: $env.GOOGLE_CLOUD_PROJECT_ID,
	};
	const environmentProjectId =
		normalizeProjectId(environment.GOOGLE_CLOUD_PROJECT) ?? normalizeProjectId(environment.GOOGLE_CLOUD_PROJECT_ID);
	if (environmentProjectId) {
		ctrl.onProgress?.("Using the Google Cloud project configured by the environment...");
		return environmentProjectId;
	}

	const antigravityProjectId = await readExternalProjectId(
		sources.readAntigravityProjectId ?? readAntigravityCliProjectId,
	);
	if (antigravityProjectId) {
		ctrl.onProgress?.("Using the Google Cloud project configured by Antigravity CLI...");
		return antigravityProjectId;
	}

	const gcloudProjectId = await readExternalProjectId(sources.readGcloudProjectId ?? readGcloudProjectId);
	if (gcloudProjectId) {
		ctrl.onProgress?.("Using the Google Cloud project configured by gcloud...");
		return gcloudProjectId;
	}

	if (!ctrl.onPrompt) return undefined;
	const input = await ctrl.onPrompt({
		message: "Google Cloud project ID (leave blank to use individual-tier discovery):",
		placeholder: "my-enterprise-project",
		allowEmpty: true,
	});
	if (!input.trim()) return undefined;
	const promptedProjectId = normalizeProjectId(input);
	if (!promptedProjectId) {
		throw new Error("Invalid Google Cloud project ID. Use 6-30 lowercase letters, digits, or hyphens.");
	}
	return promptedProjectId;
}

function buildProjectRequest(configuredProjectId: string | undefined): AntigravityProjectRequest {
	if (!configuredProjectId) {
		return { metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA };
	}
	return {
		cloudaicompanionProject: configuredProjectId,
		metadata: {
			...ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
			duetProject: configuredProjectId,
		},
	};
}

function readProjectId(value: string | { id?: string } | undefined): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (value && typeof value === "object" && typeof value.id === "string" && value.id.length > 0) {
		return value.id;
	}
	return undefined;
}

function getDefaultTierId(allowedTiers?: Array<{ id?: string; isDefault?: boolean }>): string {
	if (!allowedTiers || allowedTiers.length === 0) {
		return TIER_LEGACY;
	}
	const defaultTier = allowedTiers.find(tier => tier.isDefault && typeof tier.id === "string" && tier.id.length > 0);
	if (defaultTier?.id) {
		return defaultTier.id;
	}
	return TIER_LEGACY;
}

async function onboardProjectWithRetries(
	endpoint: string,
	headers: Record<string, string>,
	onboardBody: { tierId: string } & AntigravityProjectRequest,
	onProgress?: (message: string) => void,
): Promise<string> {
	for (let attempt = 1; attempt <= PROJECT_ONBOARD_MAX_ATTEMPTS; attempt += 1) {
		if (attempt > 1) {
			onProgress?.(`Waiting for project provisioning (attempt ${attempt}/${PROJECT_ONBOARD_MAX_ATTEMPTS})...`);
			await Bun.sleep(PROJECT_ONBOARD_INTERVAL_MS);
		}

		const onboardResponse = await fetch(`${endpoint}/v1internal:onboardUser`, {
			method: "POST",
			headers,
			body: JSON.stringify(onboardBody),
		});

		if (!onboardResponse.ok) {
			const errorText = await onboardResponse.text();
			throw new Error(`onboardUser failed: ${onboardResponse.status} ${onboardResponse.statusText}: ${errorText}`);
		}

		const operation = (await onboardResponse.json()) as LongRunningOperationResponse;
		if (!operation.done) {
			continue;
		}

		const projectId = readProjectId(operation.response?.cloudaicompanionProject);
		if (projectId) {
			return projectId;
		}
	}

	throw new Error(
		`onboardUser did not return a provisioned project id after ${PROJECT_ONBOARD_MAX_ATTEMPTS} attempts`,
	);
}

async function discoverProject(
	accessToken: string,
	configuredProjectId: string | undefined,
	onProgress?: (message: string) => void,
): Promise<string> {
	const projectRequest = buildProjectRequest(configuredProjectId);
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		...getAntigravityAuthHeaders(),
	};

	onProgress?.("Checking for existing project...");
	const endpoint = CLOUD_CODE_ENDPOINT;
	try {
		const loadResponse = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify(projectRequest),
		});

		if (!loadResponse.ok) {
			const errorText = await loadResponse.text();
			throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${loadResponse.statusText}: ${errorText}`);
		}

		const loadPayload = (await loadResponse.json()) as LoadCodeAssistPayload;
		const existingProject = readProjectId(loadPayload.cloudaicompanionProject);
		if (existingProject) {
			return configuredProjectId ?? existingProject;
		}

		const tierId = getDefaultTierId(loadPayload.allowedTiers);
		onProgress?.("Provisioning project...");
		const onboardBody = {
			tierId,
			...projectRequest,
		};
		const provisionedProject = await onboardProjectWithRetries(endpoint, headers, onboardBody, onProgress);
		return configuredProjectId ?? provisionedProject;
	} catch (error) {
		throw new Error(
			`Could not discover or provision an Antigravity project. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function getUserEmail(accessToken: string): Promise<string | undefined> {
	try {
		const response = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (response.ok) {
			const data = (await response.json()) as { email?: string };
			return data.email;
		}
	} catch {
		// Ignore errors, email is optional
	}
	return undefined;
}

class AntigravityOAuthFlow extends OAuthCallbackFlow {
	#configuredProjectId: string | undefined;

	constructor(ctrl: OAuthController, configuredProjectId: string | undefined) {
		super(ctrl, CALLBACK_PORT, CALLBACK_PATH);
		this.#configuredProjectId = configuredProjectId;
	}

	async generateAuthUrl(state: string, redirectUri: string): Promise<{ url: string; instructions?: string }> {
		const authParams = new URLSearchParams({
			client_id: CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES.join(" "),
			state,
			access_type: "offline",
			prompt: "consent",
		});

		const url = `${AUTH_URL}?${authParams.toString()}`;
		return { url, instructions: "Complete the sign-in in your browser." };
	}

	async exchangeToken(code: string, _state: string, redirectUri: string): Promise<OAuthCredentials> {
		this.ctrl.onProgress?.("Exchanging authorization code for tokens...");

		const tokenResponse = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`Token exchange failed: ${error}`);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

		if (!tokenData.refresh_token) {
			throw new Error("No refresh token received. Please try again.");
		}

		this.ctrl.onProgress?.("Getting user info...");
		const email = await getUserEmail(tokenData.access_token);
		const projectId = await discoverProject(tokenData.access_token, this.#configuredProjectId, this.ctrl.onProgress);

		return {
			refresh: tokenData.refresh_token,
			access: tokenData.access_token,
			expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
			projectId,
			email,
		};
	}
}

/**
 * Login with Antigravity OAuth
 */
export async function loginAntigravity(
	ctrl: OAuthController,
	options: AntigravityLoginOptions = {},
): Promise<OAuthCredentials> {
	const configuredProjectId = await resolveAntigravityProjectId(ctrl, options.projectSources);
	const flow = new AntigravityOAuthFlow(ctrl, configuredProjectId);
	return flow.login();
}

/**
 * Refresh Antigravity token
 */
export async function refreshAntigravityToken(refreshToken: string, projectId: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Antigravity token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
		projectId,
	};
}
