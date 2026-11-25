import type { XCSHContext } from "./xcsh-context";
import {
	deriveTenantFromUrl,
	isInjectableContextEnvKey,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_CONTEXT_NAME,
	XCSH_NAMESPACE,
	XCSH_TENANT,
} from "./xcsh-env";

/** Runtime controls keep their process precedence, independently of F5 context authority. */
export const RUNTIME_ENV_KEYS: ReadonlySet<string> = new Set([
	"XCSH_BIN",
	"XCSH_LOCALE",
	"XCSH_BROWSER_PROVIDER",
	"XCSH_DIR_NAME",
	"XCSH_DISTRIBUTION_CHANNEL",
	"XCSH_PROJECT_DIR",
	"XCSH_PROFILE_DISCOVERY",
	"XCSH_NATIVE_API_GUIDANCE",
	"XCSH_FORCE_STALE",
	"XCSH_BRIDGE_PORT",
	"XCSH_BRIDGE_PORT_START",
	"XCSH_BRIDGE_PROBE_MS",
	"XCSH_MANAGER_SOCK",
	"XCSH_MANAGER_VERSION",
	"XCSH_WORKER_SPARE",
	"XCSH_WORKER_POOL_SIZE",
	"XCSH_SESSION_ID",
	"XCSH_SESSION_TENANT",
	"XCSH_PLUGIN_ROOT",
	"XCSH_PLUGIN_DATA",
	"XCSH_PLUGIN_GIT_TIMEOUT_MS",
	"XCSH_REGISTRY_SOURCE_URL",
	"XCSH_RELEASE_CACHE_DIR",
	"XCSH_PYTHON_GATEWAY_DIR",
	"XCSH_REPLACEMENT_STATE_DIR",
	"XCSH_BENCH_EXTENSION",
	"XCSH_HERDR_ACCEPTANCE_PLAN",
	"XCSH_HERDR_BINDING_PATH",
	"XCSH_HERDR_OWNER",
	"XCSH_MEASURE_CORPUS_REQUESTS",
	"XCSH_MEASURE_DOCUMENTATION_REQUESTS",
	"XCSH_MEASURE_TERRAFORM_REQUESTS",
	"XCSH_QMD_SMOKE_OK",
	"XCSH_TERRAFORM_DOCUMENTATION_SMOKE_OK",
	"XCSH_SMOKE_TEST_QMD",
	"XCSH_SMOKE_TEST_SPECS",
	"XCSH_SMOKE_TEST_TERRAFORM_DOCUMENTATION",
	"XCSH_SMOKE_TEST_VERTEX_AUTH",
	"XCSH_REMOTE_COMMAND_DIAGNOSTICS",
	"XCSH_REMOTE_GENERATION",
	"XCSH_REMOTE_TRACE_DIRECTORY",
	"XCSH_REMOTE_TRACE_SALT",
	"XCSH_REMOTE_TRACE_SCENARIO",
	"XCSH_SANDBOX_CHECK_NAMED_SIBLING",
	"XCSH_SANDBOX_CHECK_NAMED_SIBLING_EXPECTATION",
	"XCSH_SANDBOX_OPERATOR_HOME",
	"XCSH_SANDBOX_SESSION_ROOT",
	"XCSH_TTFT_ATTRIBUTION",
	"XCSH_TTFT_ATTR_FILE",
	"XCSH_TTFT_COLD",
	"XCSH_TTFT_PROVISION_MS",
	"XCSH_TTFT_SPAWN_AT",
]);

export function isF5ContextEnvKey(key: string): boolean {
	return key.startsWith("XCSH_") && !RUNTIME_ENV_KEYS.has(key);
}

/** No process fallback: an absent or empty context value remains absent or empty. */
export function contextEnvironment(context: XCSHContext): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const [key, value] of Object.entries({
		[XCSH_API_URL]: context.apiUrl,
		[XCSH_API_TOKEN]: context.apiToken,
		[XCSH_NAMESPACE]: context.defaultNamespace,
		[XCSH_CONTEXT_NAME]: context.name,
	})) {
		if (typeof value === "string") environment[key] = value;
	}
	const tenant = deriveTenantFromUrl(context.apiUrl);
	if (tenant) environment[XCSH_TENANT] = tenant;
	for (const [key, value] of Object.entries(context.env ?? {})) {
		if (isInjectableContextEnvKey(key) && typeof value === "string") environment[key] = value;
	}
	return environment;
}

export function resolveF5Environment(
	configured: Record<string, string>,
	authority: "context" | "environment",
	inherited: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const environment = { ...configured };
	for (const [key, value] of Object.entries(inherited)) {
		if (value !== undefined && key.startsWith("XCSH_") && (authority === "environment" || !isF5ContextEnvKey(key)))
			environment[key] = value;
	}
	return environment;
}
