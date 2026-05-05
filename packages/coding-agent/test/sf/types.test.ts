import { describe, expect, it } from "bun:test";
import { ORG_ALIAS_PATTERN, SF_ORG_SAFE_FIELDS } from "../../src/tools/sf/types";

describe("SF types constants", () => {
	it("ORG_ALIAS_PATTERN accepts valid aliases", () => {
		expect(ORG_ALIAS_PATTERN.test("f5")).toBe(true);
		expect(ORG_ALIAS_PATTERN.test("my-org")).toBe(true);
		expect(ORG_ALIAS_PATTERN.test("user@example.com")).toBe(true);
		expect(ORG_ALIAS_PATTERN.test("org_name.prod")).toBe(true);
	});

	it("ORG_ALIAS_PATTERN rejects shell metacharacters", () => {
		expect(ORG_ALIAS_PATTERN.test("org;rm -rf")).toBe(false);
		expect(ORG_ALIAS_PATTERN.test("org$(whoami)")).toBe(false);
		expect(ORG_ALIAS_PATTERN.test("org|cat /etc")).toBe(false);
		expect(ORG_ALIAS_PATTERN.test("")).toBe(false);
	});

	it("SF_ORG_SAFE_FIELDS does not include sensitive fields", () => {
		const safe = SF_ORG_SAFE_FIELDS as readonly string[];
		expect(safe).not.toContain("accessToken");
		expect(safe).not.toContain("clientId");
		expect(safe).not.toContain("refreshToken");
	});
});
