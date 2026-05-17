import type { Model } from "@f5xc-salesdemos/pi-ai";
import { validateApiKeyAgainstModelsEndpoint } from "@f5xc-salesdemos/pi-ai/utils/oauth/api-key-validation";
import { $which, getProjectDir, logger } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";
import { loadProfile } from "../../internal-urls/user-profile";
import { type AuthStatus, ContextService } from "../../services/f5xc-context";
import { deriveTenantFromUrl } from "../../services/f5xc-env";
import type { AuthStorage } from "../../session/auth-storage";
import { ensureGlabConfig, parseAuthStatus } from "../../tools/glab/config";

// Startup validation budget. These are longer than validateToken's 3000ms default because
// the welcome path runs during TLS/DNS cold-start — a single 3s shot races against warm-up
// and falsely reports offline for contexts that reconnect cleanly moments later.
const STARTUP_FIRST_TIMEOUT_MS = 4000;
const STARTUP_RETRY_TIMEOUT_MS = 5000;
const STARTUP_RETRY_DELAY_MS = 500;

type ContextValidator = (opts: {
	timeoutMs: number;
}) => Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" | "url_not_found" }>;

/**
 * Runs the context validator once with a startup-sized timeout; if the result is `offline`
 * (the only transient class — auth_error/connected/unknown are definitive), waits briefly
 * to let DNS/TLS warm up, then tries once more with a longer timeout.
 */
export async function validateContextWithStartupRetry(
	validate: ContextValidator,
	options?: {
		firstTimeoutMs?: number;
		retryTimeoutMs?: number;
		retryDelayMs?: number;
	},
): Promise<{ status: AuthStatus; latencyMs?: number; errorClass?: "network" | "credential" | "url_not_found" }> {
	const firstTimeoutMs = options?.firstTimeoutMs ?? STARTUP_FIRST_TIMEOUT_MS;
	const retryTimeoutMs = options?.retryTimeoutMs ?? STARTUP_RETRY_TIMEOUT_MS;
	const retryDelayMs = options?.retryDelayMs ?? STARTUP_RETRY_DELAY_MS;

	const first = await validate({ timeoutMs: firstTimeoutMs });
	if (first.status !== "offline") return first;

	if (retryDelayMs > 0) {
		await new Promise(resolve => setTimeout(resolve, retryDelayMs));
	}
	return await validate({ timeoutMs: retryTimeoutMs });
}

export type ModelCheckState = "no_provider" | "connected" | "auth_error";

export interface ModelStatus {
	state: ModelCheckState;
	provider?: string;
	latencyMs?: number;
}

export type ContextCheckState = "no_context" | "connected" | "auth_error" | "offline";

export interface WelcomeContextStatus {
	state: ContextCheckState;
	name?: string;
	latencyMs?: number;
	errorClass?: "network" | "credential" | "url_not_found";
}

export type GitLabCheckState = "not_installed" | "connected" | "auth_error" | "not_configured" | "project_inaccessible";

export interface WelcomeGitLabStatus {
	state: GitLabCheckState;
	project?: string;
	user?: string;
}

export interface WelcomeCheckResult {
	model: ModelStatus;
	context?: WelcomeContextStatus;
}

/** Providers that don't store API keys (local inference servers) */
const KEYLESS_PROVIDERS = new Set(["ollama", "llama.cpp", "lm-studio", "llamafile", "local"]);

/**
 * Run blocking startup checks for the welcome screen.
 * Model check always runs. Context check only runs if model is connected.
 */
export async function runWelcomeChecks(
	model: Model | undefined,
	authStorage: AuthStorage,
): Promise<WelcomeCheckResult> {
	const provider = model?.provider ?? "unknown";

	// Step 1: Check model provider credentials exist
	// Keyless local providers (ollama, llama.cpp, lm-studio, etc.) don't store credentials
	if (!authStorage.hasAuth(provider) && !KEYLESS_PROVIDERS.has(provider)) {
		return { model: { state: "no_provider", provider } };
	}

	// Step 2: Live model validation — try to reach the models endpoint
	const modelStatus = await validateModelConnection(model, authStorage);
	if (modelStatus.state !== "connected") {
		return { model: modelStatus };
	}

	// Step 3: Context check (only if model is connected)
	const contextStatus = await checkContextStatus();
	return { model: modelStatus, context: contextStatus };
}

async function validateModelConnection(model: Model | undefined, authStorage: AuthStorage): Promise<ModelStatus> {
	const provider = model?.provider ?? "unknown";
	try {
		const rawApiKey = await authStorage.peekApiKey(provider);
		if (!rawApiKey) {
			// Keyless providers skip validation
			if (KEYLESS_PROVIDERS.has(provider)) {
				return { state: "connected", provider, latencyMs: 0 };
			}
			return { state: "auth_error", provider };
		}

		// Detect unresolved env var names (e.g. "LITELLM_API_KEY" sent as literal)
		if (/^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/.test(rawApiKey)) {
			return { state: "auth_error", provider };
		}

		const baseUrl = model?.baseUrl;
		if (!baseUrl) {
			return { state: "auth_error", provider };
		}

		// GitHub Copilot returns a structured JSON token {token, enterpriseUrl};
		// extract the actual token for API validation
		let apiKey = rawApiKey;
		if (provider === "github-copilot" && rawApiKey.startsWith("{")) {
			try {
				const parsed = JSON.parse(rawApiKey);
				apiKey = parsed.token ?? rawApiKey;
			} catch {
				// Not JSON — use as-is
			}
		}

		const modelsUrl = `${baseUrl}/models`;
		const start = performance.now();
		await validateApiKeyAgainstModelsEndpoint({
			provider,
			apiKey,
			modelsUrl,
		});
		const latencyMs = Math.round(performance.now() - start);
		return { state: "connected", provider, latencyMs };
	} catch {
		logger.warn("Welcome model validation failed");
		return { state: "auth_error", provider };
	}
}

async function checkContextStatus(): Promise<WelcomeContextStatus> {
	try {
		const contextService = ContextService.instance;
		if (!contextService) {
			return { state: "no_context" };
		}

		const status = contextService.getStatus();
		if (!status.isConfigured) {
			return { state: "no_context" };
		}

		const name =
			status.activeContextName ??
			(status.credentialSource === "environment" && status.activeContextUrl
				? (deriveTenantFromUrl(status.activeContextUrl) ?? "(environment)")
				: undefined);
		const result = await validateContextWithStartupRetry(opts => contextService.validateToken(opts));

		switch (result.status) {
			case "connected":
				return { state: "connected", name, latencyMs: result.latencyMs };
			case "auth_error":
				return { state: "auth_error", name };
			case "offline":
				return { state: "offline", name, errorClass: result.errorClass };
			default:
				return { state: "no_context" };
		}
	} catch {
		logger.warn("Welcome context validation failed");
		return { state: "no_context" };
	}
}

/** Idempotent startup check: glab installed -> authenticated -> config ensured -> project verified. */
export async function checkGitLabStatus(cwd: string): Promise<WelcomeGitLabStatus | undefined> {
	try {
		if (!$which("glab")) return undefined;

		// Step 1: Check authentication, parse hostname + user
		const authResult = await $`glab auth status`.quiet().nothrow();
		if (authResult.exitCode !== 0) return { state: "auth_error" };
		const { hostname, user } = parseAuthStatus(authResult.stderr.toString());

		// Step 2: Suppress glab update nag that pollutes stderr (idempotent)
		await $`glab config set check_update false`.quiet().nothrow();

		// Step 3: Try to detect project from git remote in cwd
		let detectedProject: string | undefined;
		const repoResult = await $`glab repo view --output json`.cwd(cwd).quiet().nothrow();
		if (repoResult.exitCode === 0) {
			try {
				const repo = JSON.parse(repoResult.text());
				if (repo.path_with_namespace) detectedProject = repo.path_with_namespace;
			} catch {
				// JSON parse failed — ignore
			}
		}

		// Step 4: Ensure config (merges existing + detected + defaults)
		const config = await ensureGlabConfig(cwd, { hostname, project: detectedProject });

		// Step 5: If we have a project, verify access
		if (config.project) {
			const encoded = encodeURIComponent(config.project);
			const accessResult = await $`glab api projects/${encoded}`.quiet().nothrow();
			if (accessResult.exitCode === 0) {
				return { state: "connected", project: config.project, user };
			}
			return { state: "project_inaccessible", project: config.project, user };
		}

		return { state: "not_configured", user };
	} catch (err) {
		logger.warn("GitLab startup check failed", { error: String(err) });
		return { state: "not_configured" };
	}
}

export type SalesforceCheckState = "connected" | "auth_error" | "session_expired" | "not_configured";

export interface WelcomeSalesforceStatus {
	state: SalesforceCheckState;
	username?: string;
	orgAlias?: string;
	instanceUrl?: string;
}

/** Idempotent startup check: sf installed -> org list -> default org -> display status. */
export async function checkSalesforceStatus(_cwd: string): Promise<WelcomeSalesforceStatus | undefined> {
	try {
		if (!$which("sf")) return undefined;

		// Suppress telemetry consent nag (idempotent)
		await $`sf config set disable-telemetry true --global`.quiet().nothrow();

		// Step 1: Get org list
		const listResult = await $`sf org list --json`.quiet().nothrow();
		if (listResult.exitCode !== 0) return { state: "auth_error" };

		let listData: {
			result?: {
				nonScratchOrgs?: unknown[];
				sandboxes?: unknown[];
				scratchOrgs?: unknown[];
				devHubs?: unknown[];
				other?: unknown[];
			};
		};
		try {
			listData = JSON.parse(listResult.text());
		} catch {
			return { state: "auth_error" };
		}

		const r = listData.result ?? {};
		const seen = new Set<string>();
		const allRawOrgs = (
			[
				...(r.nonScratchOrgs ?? []),
				...(r.sandboxes ?? []),
				...(r.scratchOrgs ?? []),
				...(r.devHubs ?? []),
				...(r.other ?? []),
			] as Record<string, unknown>[]
		).filter(org => {
			const id = String(org.orgId ?? org.orgid ?? "");
			if (!id || seen.has(id)) return false;
			seen.add(id);
			return true;
		});

		if (allRawOrgs.length === 0) return { state: "auth_error" };

		// Step 2: Find default org (normalize raw CLI fields)
		const defaultRaw = allRawOrgs.find(
			org =>
				(typeof org.defaultMarker === "string" && org.defaultMarker.includes("(U)")) ||
				org.isDefaultUsername === true,
		);

		if (!defaultRaw) {
			return { state: "not_configured", username: allRawOrgs[0]?.username as string | undefined };
		}

		const alias = (defaultRaw.alias ?? defaultRaw.username) as string;

		// Step 3: Display org details
		const displayResult = await $`sf org display --target-org ${alias} --json`.quiet().nothrow();
		if (displayResult.exitCode !== 0) {
			return { state: "session_expired", username: defaultRaw.username as string | undefined, orgAlias: alias };
		}

		let displayData: { result?: Record<string, unknown> };
		try {
			displayData = JSON.parse(displayResult.text());
		} catch {
			return { state: "session_expired", username: defaultRaw.username as string | undefined, orgAlias: alias };
		}

		const result = displayData.result;
		if (!result || result.connectedStatus !== "Connected") {
			return { state: "session_expired", username: defaultRaw.username as string | undefined, orgAlias: alias };
		}

		return {
			state: "connected",
			username: result.username as string | undefined,
			orgAlias: alias,
			instanceUrl: result.instanceUrl as string | undefined,
		};
	} catch (err) {
		logger.warn("Salesforce startup check failed", { error: String(err) });
		return { state: "auth_error" };
	}
}

export type GitHubCheckState = "connected" | "auth_error";

export interface WelcomeGitHubStatus {
	state: GitHubCheckState;
}

export async function checkGitHubStatus(): Promise<WelcomeGitHubStatus | undefined> {
	try {
		if (!$which("gh")) return undefined;
		const result = await $`gh auth status`.quiet().nothrow();
		return { state: result.exitCode === 0 ? "connected" : "auth_error" };
	} catch (err) {
		logger.warn("GitHub startup check failed", { error: String(err) });
		return { state: "auth_error" };
	}
}

export type ServiceState = "connected" | "unauthenticated" | "unavailable";

export interface ServiceStatus {
	name: string;
	state: ServiceState;
	hint?: string;
}

export function mapContextStatus(status: WelcomeContextStatus): ServiceStatus {
	switch (status.state) {
		case "connected":
			return { name: "F5 XC Context", state: "connected" };
		case "no_context":
			return { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context create" };
		case "auth_error":
			return { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context" };
		case "offline":
			switch (status.errorClass) {
				case "network":
					return { name: "F5 XC Context", state: "unauthenticated", hint: "network unreachable" };
				case "url_not_found":
					return { name: "F5 XC Context", state: "unauthenticated", hint: "tenant URL not found" };
				default:
					return { name: "F5 XC Context", state: "unauthenticated", hint: "run: /context" };
			}
	}
}

export function mapGitLabStatus(status: WelcomeGitLabStatus | undefined): ServiceStatus {
	if (!status) return { name: "GitLab", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "GitLab", state: "connected" };
		case "not_installed":
			return { name: "GitLab", state: "unavailable", hint: "not installed" };
		case "project_inaccessible":
			return { name: "GitLab", state: "unauthenticated", hint: "check project access" };
		default:
			return { name: "GitLab", state: "unauthenticated", hint: "run: glab auth login" };
	}
}

export function mapSalesforceStatus(status: WelcomeSalesforceStatus | undefined): ServiceStatus {
	if (!status) return { name: "Salesforce", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "Salesforce", state: "connected" };
		case "session_expired":
			return { name: "Salesforce", state: "unauthenticated", hint: "session expired, run: sf org login web" };
		case "not_configured":
			return { name: "Salesforce", state: "unauthenticated", hint: "run: sf org login web --set-default" };
		default:
			return { name: "Salesforce", state: "unauthenticated", hint: "run: sf org login web" };
	}
}

export function mapGitHubStatus(status: WelcomeGitHubStatus | undefined): ServiceStatus {
	if (!status) return { name: "GitHub", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "GitHub", state: "connected" };
		case "auth_error":
			return { name: "GitHub", state: "unauthenticated", hint: "run: gh auth login" };
	}
}

export type AzureCheckState = "connected" | "auth_error";

export interface WelcomeAzureStatus {
	state: AzureCheckState;
}

export async function checkAzureStatus(): Promise<WelcomeAzureStatus | undefined> {
	try {
		if (!$which("az")) return undefined;
		const result = await $`az account show --output json`.quiet().nothrow();
		return { state: result.exitCode === 0 ? "connected" : "auth_error" };
	} catch (err) {
		logger.warn("Azure startup check failed", { error: String(err) });
		return { state: "auth_error" };
	}
}

export function mapAzureStatus(status: WelcomeAzureStatus | undefined): ServiceStatus {
	if (!status) return { name: "Azure", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "Azure", state: "connected" };
		case "auth_error":
			return { name: "Azure", state: "unauthenticated", hint: "run: az login --use-device-code" };
	}
}

export type AwsCheckState =
	| "connected"
	| "sso_expired"
	| "not_configured"
	| "profile_not_found"
	| "network_error"
	| "auth_error";

export interface WelcomeAwsStatus {
	state: AwsCheckState;
}

/** Classify AWS CLI stderr into a specific failure state. Exported for testing. */
export function classifyAwsError(stderr: string): AwsCheckState {
	const s = stderr.toLowerCase();
	// SSO session/token expiry
	if (
		s.includes("sso session") ||
		s.includes("sso token") ||
		(s.includes("token from sso") && (s.includes("expired") || s.includes("refresh failed"))) ||
		s.includes("expiredtokenexception") ||
		s.includes("expiredtoken")
	) {
		return "sso_expired";
	}
	// No credentials configured at all
	if (s.includes("unable to locate credentials")) {
		return "not_configured";
	}
	// AWS_PROFILE points to a non-existent profile
	if (s.includes("config profile") && s.includes("could not be found")) {
		return "profile_not_found";
	}
	// Network/connectivity errors
	if (s.includes("could not connect") || s.includes("connection error") || s.includes("endpoint url")) {
		return "network_error";
	}
	return "auth_error";
}

export async function checkAwsStatus(): Promise<WelcomeAwsStatus | undefined> {
	try {
		if (!$which("aws")) return undefined;
		const result = await $`aws sts get-caller-identity --output json`.quiet().nothrow();
		if (result.exitCode === 0) return { state: "connected" };
		const stderr = result.stderr.toString();
		return { state: classifyAwsError(stderr) };
	} catch (err) {
		logger.warn("AWS startup check failed", { error: String(err) });
		return { state: "auth_error" };
	}
}

export function mapAwsStatus(status: WelcomeAwsStatus | undefined): ServiceStatus {
	if (!status) return { name: "AWS", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "AWS", state: "connected" };
		case "sso_expired":
			return { name: "AWS", state: "unauthenticated", hint: "SSO session expired, run: aws sso login" };
		case "not_configured":
			return { name: "AWS", state: "unauthenticated", hint: "run: aws configure" };
		case "profile_not_found":
			return { name: "AWS", state: "unauthenticated", hint: "check AWS_PROFILE env var" };
		case "network_error":
			return { name: "AWS", state: "unauthenticated", hint: "network unreachable" };
		case "auth_error":
			return { name: "AWS", state: "unauthenticated", hint: "run: aws configure" };
	}
}

export type GcloudCheckState = "connected" | "token_expired" | "auth_error";

export interface WelcomeGcloudStatus {
	state: GcloudCheckState;
}

/** Classify gcloud stderr into a specific failure state. Exported for testing. */
export function classifyGcloudError(stderr: string): GcloudCheckState {
	const s = stderr.toLowerCase();
	if (s.includes("valid credentials") || s.includes("refreshing your current auth tokens")) {
		return "token_expired";
	}
	return "auth_error";
}

export async function checkGcloudStatus(): Promise<WelcomeGcloudStatus | undefined> {
	try {
		if (!$which("gcloud")) return undefined;
		const result = await $`gcloud auth print-access-token --quiet`.quiet().nothrow();
		if (result.exitCode === 0 && result.text().trim().length > 0) {
			return { state: "connected" };
		}
		const stderr = result.stderr.toString();
		return { state: classifyGcloudError(stderr) };
	} catch (err) {
		logger.warn("Google Cloud startup check failed", { error: String(err) });
		return { state: "auth_error" };
	}
}

export function mapGcloudStatus(status: WelcomeGcloudStatus | undefined): ServiceStatus {
	if (!status) return { name: "Google Cloud", state: "unavailable", hint: "not installed" };
	switch (status.state) {
		case "connected":
			return { name: "Google Cloud", state: "connected" };
		case "token_expired":
			return { name: "Google Cloud", state: "unauthenticated", hint: "token expired, run: gcloud auth login" };
		case "auth_error":
			return { name: "Google Cloud", state: "unauthenticated", hint: "run: gcloud auth login" };
	}
}

export type ProfileCheckState = "current" | "stale" | "missing";

export interface WelcomeProfileStatus {
	state: ProfileCheckState;
	name?: string;
	updatedAt?: string;
	staleDays?: number;
}

const PROFILE_STALE_HOURS = 24;

/** Check user profile freshness. Returns undefined only on unexpected error. */
export async function checkProfileStatus(): Promise<WelcomeProfileStatus | undefined> {
	try {
		const profile = await loadProfile();
		if (!profile.givenName && !profile.familyName) {
			return { state: "missing" };
		}
		const name = [profile.givenName, profile.familyName].filter(Boolean).join(" ");
		const updatedAt = profile.updatedAt;

		if (!updatedAt) {
			return { state: "stale", name };
		}

		const ageHours = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);
		if (ageHours > PROFILE_STALE_HOURS) {
			return {
				state: "stale",
				name,
				updatedAt,
				staleDays: Math.floor(ageHours / 24),
			};
		}

		return { state: "current", name, updatedAt };
	} catch {
		return { state: "missing" };
	}
}

export interface FixableService {
	name: string;
	prompt: string;
	command: string[];
	recheck: () => Promise<ServiceStatus>;
}

export function getFixableServices(statuses: {
	aws: WelcomeAwsStatus | undefined;
	azure: WelcomeAzureStatus | undefined;
	gcloud: WelcomeGcloudStatus | undefined;
	github: WelcomeGitHubStatus | undefined;
	gitlab: WelcomeGitLabStatus | undefined;
	salesforce: WelcomeSalesforceStatus | undefined;
}): FixableService[] {
	const fixable: FixableService[] = [];

	if (statuses.gitlab?.state === "auth_error") {
		fixable.push({
			name: "GitLab",
			prompt: "GitLab not authenticated",
			command: ["glab", "auth", "login"],
			recheck: async () => mapGitLabStatus(await checkGitLabStatus(getProjectDir())),
		});
	}
	if (statuses.github?.state === "auth_error") {
		fixable.push({
			name: "GitHub",
			prompt: "GitHub not authenticated",
			command: ["gh", "auth", "login"],
			recheck: async () => mapGitHubStatus(await checkGitHubStatus()),
		});
	}
	if (statuses.salesforce?.state === "session_expired") {
		fixable.push({
			name: "Salesforce",
			prompt: "Salesforce session expired",
			command: ["sf", "org", "login", "web"],
			recheck: async () => mapSalesforceStatus(await checkSalesforceStatus(getProjectDir())),
		});
	}
	if (statuses.azure?.state === "auth_error") {
		fixable.push({
			name: "Azure",
			prompt: "Azure session expired",
			command: ["az", "login", "--use-device-code"],
			recheck: async () => mapAzureStatus(await checkAzureStatus()),
		});
	}
	if (statuses.aws?.state === "sso_expired") {
		fixable.push({
			name: "AWS",
			prompt: "AWS SSO session expired",
			command: ["aws", "sso", "login"],
			recheck: async () => mapAwsStatus(await checkAwsStatus()),
		});
	}
	if (statuses.gcloud?.state === "token_expired") {
		fixable.push({
			name: "Google Cloud",
			prompt: "Google Cloud token expired",
			command: ["gcloud", "auth", "login"],
			recheck: async () => mapGcloudStatus(await checkGcloudStatus()),
		});
	}

	return fixable;
}
