import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	deriveTenantFromUrl,
	hasEnvOverride,
	normalizeApiUrl,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_NAMESPACE,
} from "@f5xc-salesdemos/xcsh/services/xcsh-env";

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
			process.env[XCSH_API_URL] = "https://acme.console.ves.volterra.io";
			expect(hasEnvOverride()).toBe(false);
		});
	});

	describe("deriveTenantFromUrl", () => {
		it("returns the first hostname label for a normal F5 XC URL", () => {
			expect(deriveTenantFromUrl("https://acme.console.ves.volterra.io")).toBe("acme");
		});

		it("lowercases mixed-case labels", () => {
			expect(deriveTenantFromUrl("https://Acme-01.console.example.com")).toBe("acme-01");
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
			expect(deriveTenantFromUrl("https://acme_01.example.com")).toBeNull();
		});

		it("returns null for labels with a leading hyphen", () => {
			expect(deriveTenantFromUrl("https://-acme.example.com")).toBeNull();
		});

		it("returns null for labels with a trailing hyphen", () => {
			expect(deriveTenantFromUrl("https://acme-.example.com")).toBeNull();
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
