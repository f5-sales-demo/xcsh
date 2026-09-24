import { describe, expect, test } from "bun:test";
import { resolveACPMCPEnabled, resolveCliMCPEnabled, resolveSDKMCPEnabled } from "../src/mcp/policy";

describe("MCP opt-in policy", () => {
	test("CLI defaults to the trusted user setting", () => {
		expect(resolveCliMCPEnabled({ userEnabled: false })).toBe(false);
		expect(resolveCliMCPEnabled({ userEnabled: true })).toBe(true);
	});

	test("explicit CLI flags override the trusted user setting", () => {
		expect(resolveCliMCPEnabled({ mcp: true, userEnabled: false })).toBe(true);
		expect(resolveCliMCPEnabled({ noMcp: true, userEnabled: true })).toBe(false);
		expect(resolveCliMCPEnabled({ noTools: true, userEnabled: true })).toBe(false);
	});

	test("conflicting CLI flags fail before startup", () => {
		expect(() => resolveCliMCPEnabled({ mcp: true, noMcp: true, userEnabled: false })).toThrow(
			"--mcp cannot be combined with --no-mcp",
		);
		expect(() => resolveCliMCPEnabled({ mcp: true, noTools: true, userEnabled: false })).toThrow(
			"--mcp cannot be combined with --no-tools",
		);
	});

	test("SDK requires literal true", () => {
		expect(resolveSDKMCPEnabled(undefined)).toBe(false);
		expect(resolveSDKMCPEnabled(false)).toBe(false);
		expect(resolveSDKMCPEnabled(true)).toBe(true);
	});

	test("ACP enables only non-empty client descriptors", () => {
		expect(resolveACPMCPEnabled(undefined)).toBe(false);
		expect(resolveACPMCPEnabled([])).toBe(false);
		expect(resolveACPMCPEnabled([{ name: "explicit" }])).toBe(true);
	});
});
