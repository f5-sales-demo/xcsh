/**
 * Shared test fixtures for F5 XC authentication tests.
 *
 * All values are synthetic — no real credentials or tenant URLs.
 * Real credentials must NEVER appear in source code.
 *
 * For live/integration tests against a real F5 XC tenant, set these
 * environment variables before running tests:
 *   XCSH_API_URL      — e.g. https://<tenant>.console.ves.volterra.io
 *   XCSH_API_TOKEN    — your API token
 *   XCSH_NAMESPACE    — your namespace
 */

export const TEST_XCSH_URL = process.env.TEST_XCSH_URL ?? "https://test-tenant.console.ves.volterra.io";
export const TEST_XCSH_TOKEN = process.env.TEST_XCSH_TOKEN ?? "FAKE-TOKEN-FOR-UNIT-TESTS";
export const TEST_XCSH_NAMESPACE = process.env.TEST_XCSH_NAMESPACE ?? "default";
export const TEST_XCSH_MASKED_TOKEN = `...${(process.env.TEST_XCSH_TOKEN ?? "FAKE-TOKEN-FOR-UNIT-TESTS").slice(-4)}`;

export const TEST_CONTEXT = {
	name: "production",
	apiUrl: TEST_XCSH_URL,
	apiToken: TEST_XCSH_TOKEN,
	defaultNamespace: TEST_XCSH_NAMESPACE,
} as const;

export const TEST_STAGING_URL = process.env.TEST_XCSH_STAGING_URL ?? "https://test-staging.console.ves.volterra.io";
export const TEST_STAGING_TOKEN = process.env.TEST_XCSH_STAGING_TOKEN ?? "FAKE-STAGING-TOKEN-FOR-TESTS";
export const TEST_STAGING_NAMESPACE = process.env.TEST_XCSH_STAGING_NAMESPACE ?? "staging-ns";

export const TEST_CONTEXT_STAGING = {
	name: "staging",
	apiUrl: TEST_STAGING_URL,
	apiToken: TEST_STAGING_TOKEN,
	defaultNamespace: TEST_STAGING_NAMESPACE,
} as const;

/** Context with additional env map for extended variable tests */
export const TEST_CONTEXT_WITH_ENV = {
	name: "production",
	apiUrl: TEST_XCSH_URL,
	apiToken: TEST_XCSH_TOKEN,
	defaultNamespace: TEST_XCSH_NAMESPACE,
	env: {
		XCSH_EMAIL: "test@example.com",
		XCSH_USERNAME: "exampleuser@example.com",
		XCSH_CONSOLE_PASSWORD: "test-console-pass",
		XCSH_LB_NAME: "test-lb",
		XCSH_DOMAINNAME: "test.example.com",
		XCSH_ROOT_DOMAIN: "example.com",
	},
} as const;

/** 128-char realistic token for masking boundary tests */
export const TEST_LONG_TOKEN =
	"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.AAAAAAAAAA_BBBBBBBBBB_CCCCCCCCCC_DDDDDDDDDD_EEEEEEEEEE_FFFFFFFFFF_GGGGGGGGGGHHHHIIII";

/** Context with metadata fields for /context show metadata display test */
export const TEST_CONTEXT_WITH_METADATA = {
	name: "with-meta",
	apiUrl: TEST_XCSH_URL,
	apiToken: TEST_XCSH_TOKEN,
	defaultNamespace: TEST_XCSH_NAMESPACE,
	metadata: {
		createdAt: "2026-03-15T00:00:00.000Z",
		expiresAt: "2027-03-15T00:00:00.000Z",
	},
} as const;

/** Context with schema version 2 — intentionally incompatible with CURRENT_SCHEMA_VERSION (=1). */
export const TEST_CONTEXT_INCOMPATIBLE = {
	name: "future-schema",
	apiUrl: TEST_XCSH_URL,
	apiToken: TEST_XCSH_TOKEN,
	defaultNamespace: TEST_XCSH_NAMESPACE,
	version: 2,
} as const;

/** Context with knowledge sources and skill filters for #356 tests */
export const TEST_CONTEXT_WITH_KNOWLEDGE = {
	name: "with-knowledge",
	apiUrl: TEST_XCSH_URL,
	apiToken: TEST_XCSH_TOKEN,
	defaultNamespace: TEST_XCSH_NAMESPACE,
	knowledgeSources: [
		{ url: "/home/test/skills", type: "skill-dir" as const, label: "Custom Skills" },
		{ url: "https://example.com/llms.txt", type: "llms-txt" as const },
	],
	includeSkills: ["xcsh-*"],
	excludeSkills: ["deprecated-*"],
} as const;
