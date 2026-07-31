import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	deriveTenantEnv,
	deriveTenantFromUrl,
	hasEnvOverride,
	normalizeApiUrl,
	sessionKeyFromUrl,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_NAMESPACE,
} from "@f5-sales-demo/xcsh/services/xcsh-env";

describe("xcsh-env", () => {
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) {
				savedEnv[key] = process.env[key];
				delete process.env[key];
			}
		}
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("XCSH_")) delete process.env[key];
		}
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value !== undefined) process.env[key] = value;
		}
	});

	describe("hasEnvOverride", () => {
		it("returns false when no XCSH env vars are set", () => {
			expect(hasEnvOverride()).toBe(false);
		});

		it("returns true when XCSH_API_TOKEN is set", () => {
			process.env[XCSH_API_TOKEN] = "tok";
			expect(hasEnvOverride()).toBe(true);
		});

		it("returns true when XCSH_NAMESPACE is set", () => {
			process.env[XCSH_NAMESPACE] = "ns";
			expect(hasEnvOverride()).toBe(true);
		});

		it("returns true when both XCSH_API_TOKEN and XCSH_NAMESPACE are set", () => {
			process.env[XCSH_API_TOKEN] = "tok";
			process.env[XCSH_NAMESPACE] = "ns";
			expect(hasEnvOverride()).toBe(true);
		});

		it("returns false when only XCSH_API_URL is set (URL alone is not an override)", () => {
			process.env[XCSH_API_URL] = "https://example.console.ves.volterra.io";
			expect(hasEnvOverride()).toBe(false);
		});
	});

	describe("sessionKeyFromUrl", () => {
		it("keys staging and production of the same tenant distinctly", () => {
			expect(sessionKeyFromUrl("https://example.staging.volterra.us/web/home")).toEqual({
				tenant: "example",
				env: "staging",
			});
			expect(sessionKeyFromUrl("https://example.console.ves.volterra.io/web/x")).toEqual({
				tenant: "example",
				env: "production",
			});
		});
		it("fails closed on the shared SaaS console/realm, IPs, and junk", () => {
			expect(sessionKeyFromUrl("https://console.ves.volterra.io/web/devportal/domain")).toBeNull();
			expect(
				sessionKeyFromUrl("https://login.ves.volterra.io/auth/realms/volterra/protocol/openid-connect/auth"),
			).toBeNull();
			expect(sessionKeyFromUrl("https://192.168.1.10/web/home")).toBeNull();
			expect(sessionKeyFromUrl(undefined)).toBeNull();
		});

		// Cross-repo parity guard (#1872). This GOLDEN table is asserted verbatim in
		// the Chrome extension's test/session-key-parity.test.ts against ITS copy of
		// sessionKeyFromUrl (src/tab-binding.ts). The two implementations must agree
		// on every cell — a discovered worker's key must match the tab's key, or the
		// panel gate shows "No xcsh running for this tenant". Change one, change both.
		const GOLDEN: Array<[string | undefined, { tenant: string; env: "production" | "staging" } | null]> = [
			["https://example.console.ves.volterra.io/web/x", { tenant: "example", env: "production" }],
			["https://example.staging.volterra.us/web/home", { tenant: "example", env: "staging" }],
			["https://f5-amer-ent.console.ves.volterra.io/web/home?iss=x", { tenant: "example-corp", env: "production" }],
			[
				"https://login.ves.volterra.io/auth/realms/example-abc123/protocol/openid-connect/auth",
				{ tenant: "example", env: "production" },
			],
			[
				"https://login-staging.volterra.us/auth/realms/example-x/protocol/openid-connect/auth",
				{ tenant: "example", env: "staging" },
			],
			["https://console.ves.volterra.io/web/devportal/domain", null],
			["https://login.ves.volterra.io/auth/realms/volterra/protocol/openid-connect/auth", null],
			["https://example.ves.volterra.io", null],
			["https://192.168.1.10/web/home", null],
			["https://api.gateway.internal", null],
			[undefined, null],
		];
		it.each(GOLDEN)("parity: %s", (url, expected) => {
			expect(sessionKeyFromUrl(url)).toEqual(expected);
		});
	});

	// Guards the extension tenant-advertisement contract (#1872): the worker's
	// hello_ack must carry BOTH tenant and env whenever the tenant is known, or
	// the extension's `liveTenants` filter (needs tenant && env) drops the bridge
	// and the panel shows "No xcsh running for this tenant". `deriveTenantEnv`
	// prefers the apiUrl-derived key but MUST fall back to the assigned tenant key
	// so an unparseable apiUrl never blanks a known tenant.
	describe("deriveTenantEnv", () => {
		// [label, apiUrl, tenantKey, expectedTenant, expectedEnv]
		const M: Array<[string, string | null, string | null | undefined, string | null, string | null]> = [
			// apiUrl parses → apiUrl wins (the live/active context is authoritative)
			[
				"console apiUrl + tenantKey → apiUrl wins",
				"https://example.console.ves.volterra.io",
				"example|production",
				"example",
				"production",
			],
			[
				"staging apiUrl → staging env",
				"https://example.staging.volterra.us/web/home",
				"example|production",
				"example",
				"staging",
			],
			[
				"apiUrl tenant overrides a stale tenantKey",
				"https://real.console.ves.volterra.io",
				"stale|staging",
				"real",
				"production",
			],
			// apiUrl present but UNPARSEABLE → fall back to tenantKey (the #1872 fix)
			[
				"non-console apiUrl + tenantKey → FALLBACK",
				"https://example.ves.volterra.io",
				"example|production",
				"example",
				"production",
			],
			[
				"bare console host + tenantKey → FALLBACK",
				"https://console.ves.volterra.io",
				"example|production",
				"example",
				"production",
			],
			[
				"unparseable apiUrl + staging tenantKey → FALLBACK",
				"https://api.gateway.internal",
				"example|staging",
				"example",
				"staging",
			],
			// no apiUrl → tenantKey (contextless bound worker / adopted spare)
			["no apiUrl + tenantKey", null, "example|production", "example", "production"],
			// nothing known → null (unbound spare / interactive no-context)
			["no apiUrl + no tenantKey → null", null, null, null, null],
			["unparseable apiUrl + no tenantKey → null", "https://api.gateway.internal", null, null, null],
			["unparseable apiUrl + empty tenantKey → null", "https://api.gateway.internal", "", null, null],
			// malformed tenantKey (missing env half) → tenant only, env null
			["tenantKey without env half → tenant only", null, "example", "example", null],
		];
		it.each(M)("%s", (_label, apiUrl, tenantKey, tenant, env) => {
			expect(deriveTenantEnv(apiUrl, tenantKey)).toEqual({ tenant, env });
		});
	});

	describe("deriveTenantFromUrl", () => {
		it("returns the first hostname label for a normal F5 XC URL", () => {
			expect(deriveTenantFromUrl("https://example.console.ves.volterra.io")).toBe("example");
		});

		it("lowercases mixed-case labels", () => {
			expect(deriveTenantFromUrl("https://Example-01.console.example.com")).toBe("example-01");
		});

		it("returns a 63-character label as-is", () => {
			const label = "a".repeat(63);
			expect(deriveTenantFromUrl(`https://${label}.example.com`)).toBe(label);
		});

		it("returns null for a 64-character label (exceeds DNS label limit)", () => {
			const label = "a".repeat(64);
			expect(deriveTenantFromUrl(`https://${label}.example.com`)).toBeNull();
		});

		it("returns null for labels containing underscores", () => {
			expect(deriveTenantFromUrl("https://example_01.example.com")).toBeNull();
		});

		it("returns null for labels with a leading hyphen", () => {
			expect(deriveTenantFromUrl("https://-example.example.com")).toBeNull();
		});

		it("returns null for labels with a trailing hyphen", () => {
			expect(deriveTenantFromUrl("https://example-.example.com")).toBeNull();
		});

		it("returns null for dotless hostnames (including localhost)", () => {
			expect(deriveTenantFromUrl("https://localhost")).toBeNull();
		});

		it("returns null for completely invalid URLs", () => {
			expect(deriveTenantFromUrl("not a url")).toBeNull();
		});

		it("returns '192' for an IP-address URL (documented edge case: numeric DNS labels are valid)", () => {
			expect(deriveTenantFromUrl("https://192.168.1.1")).toBe("192");
		});
	});

	describe("normalizeApiUrl", () => {
		it("leaves an origin-only URL unchanged (idempotent)", () => {
			expect(normalizeApiUrl("https://tenant.console.ves.volterra.io")).toBe(
				"https://tenant.console.ves.volterra.io",
			);
		});

		it("strips a trailing slash", () => {
			expect(normalizeApiUrl("https://host.example.com/")).toBe("https://host.example.com");
		});

		it("strips an /api path suffix to the origin", () => {
			expect(normalizeApiUrl("https://host.example.com/api")).toBe("https://host.example.com");
		});

		it("reduces a pasted full browser URL to its origin", () => {
			const pasted =
				"https://f5-amer-ent.console.ves.volterra.io/web/home?iss=https%3A%2F%2Flogin.ves.volterra.io%2Fauth%2Frealms%2Ff5-amer-ent-x";
			expect(normalizeApiUrl(pasted)).toBe("https://f5-amer-ent.console.ves.volterra.io");
		});

		it("preserves a non-default port", () => {
			expect(normalizeApiUrl("https://host.example.com:9443/api")).toBe("https://host.example.com:9443");
		});

		it("falls back to trailing-slash stripping for an unparseable value", () => {
			expect(normalizeApiUrl("not-a-url/")).toBe("not-a-url");
		});
	});
});
