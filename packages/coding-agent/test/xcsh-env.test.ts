import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	deriveTenantFromUrl,
	XCSH_API_TOKEN,
	XCSH_API_URL,
	XCSH_NAMESPACE,
	hasEnvOverride,
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
		it("returns false when no F5XC env vars are set", () => {
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
});
