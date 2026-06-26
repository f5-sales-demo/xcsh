import { afterEach, describe, expect, it } from "bun:test";

import {
	checkAllPrerequisites,
	checkAuth,
	checkPrerequisite,
	checkToolReady,
	clearPrerequisiteCache,
	installTool,
	setupTool,
	withRetry,
} from "@f5-sales-demo/xcsh/extensibility/plugins/marketplace/prerequisites";
import type { MarketplacePluginEntry } from "@f5-sales-demo/xcsh/extensibility/plugins/marketplace/types";

afterEach(() => {
	clearPrerequisiteCache();
});

// ── withRetry ────────────────────────────────────────────────────────────────

describe("withRetry", () => {
	it("succeeds on first attempt", async () => {
		let calls = 0;
		const result = await withRetry(async () => {
			calls++;
			return "ok";
		});
		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	it("retries on failure and succeeds on later attempt", async () => {
		let calls = 0;
		const result = await withRetry(
			async () => {
				calls++;
				if (calls < 3) throw new Error("transient");
				return "recovered";
			},
			{ maxRetries: 3, baseDelayMs: 10 },
		);
		expect(result).toBe("recovered");
		expect(calls).toBe(3);
	});

	it("gives up after maxRetries and throws", async () => {
		let calls = 0;
		try {
			await withRetry(
				async () => {
					calls++;
					throw new Error("permanent");
				},
				{ maxRetries: 2, baseDelayMs: 10 },
			);
			expect(true).toBe(false);
		} catch (err) {
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toBe("permanent");
		}
		expect(calls).toBe(3);
	});

	it("defaults to 3 retries when not specified", async () => {
		let calls = 0;
		try {
			await withRetry(
				async () => {
					calls++;
					throw new Error("fail");
				},
				{ baseDelayMs: 10 },
			);
		} catch {
			// expected
		}
		expect(calls).toBe(4);
	});
});

// ── installTool ──────────────────────────────────────────────────────────────

describe("installTool", () => {
	it("returns success for a command that exits 0", async () => {
		const result = await installTool("echo installed", { maxRetries: 0 });
		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();
	});

	it("returns failure for a command that exits non-zero", async () => {
		const result = await installTool("false", { maxRetries: 0 });
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("returns failure for a nonexistent command", async () => {
		const result = await installTool("__xcsh_nonexistent_installer__", { maxRetries: 0 });
		expect(result.success).toBe(false);
	});
});

// ── checkAuth ────────────────────────────────────────────────────────────────

describe("checkAuth", () => {
	it("returns authenticated: true for a command that exits 0", async () => {
		const result = await checkAuth("echo ok");
		expect(result.authenticated).toBe(true);
	});

	it("returns authenticated: false for a command that exits non-zero", async () => {
		const result = await checkAuth("false");
		expect(result.authenticated).toBe(false);
	});

	it("returns authenticated: false for a nonexistent command", async () => {
		const result = await checkAuth("__xcsh_fake_auth_check__");
		expect(result.authenticated).toBe(false);
	});

	it("parses JSON output for user info", async () => {
		const result = await checkAuth('echo {"user":{"name":"testuser"}}');
		expect(result.authenticated).toBe(true);
		expect(result.user).toBe("testuser");
	});

	it("handles non-JSON output gracefully", async () => {
		const result = await checkAuth("echo not-json");
		expect(result.authenticated).toBe(true);
		expect(result.user).toBeUndefined();
	});
});

// ── checkToolReady ───────────────────────────────────────────────────────────

describe("checkToolReady", () => {
	it("returns installed + authenticated for a tool with passing auth check", async () => {
		const status = await checkToolReady({
			tool: "echo",
			installCmd: "echo noop",
			detectCmd: "echo ok",
			authDetectCmd: "echo ok",
		});
		expect(status.installed).toBe(true);
		expect(status.authenticated).toBe(true);
	});

	it("returns installed: false for a missing tool", async () => {
		const status = await checkToolReady({
			tool: "fake",
			installCmd: "brew install fake",
			detectCmd: "__xcsh_fake__ --version",
		});
		expect(status.installed).toBe(false);
		expect(status.authenticated).toBe(false);
	});

	it("returns authenticated: true when no authDetectCmd", async () => {
		const status = await checkToolReady({
			tool: "echo",
			installCmd: "brew install echo",
			detectCmd: "echo ok",
		});
		expect(status.installed).toBe(true);
		expect(status.authenticated).toBe(true);
	});
});

// ── setupTool (idempotent) ───────────────────────────────────────────────────

describe("setupTool", () => {
	it("skips install for already-installed tool", async () => {
		const result = await setupTool({
			tool: "echo",
			installCmd: "echo noop",
			detectCmd: "echo ok",
			authDetectCmd: "echo ok",
		});
		expect(result.wasInstalled).toBe(true);
		expect(result.installAttempted).toBe(false);
		expect(result.authenticated).toBe(true);
	});

	it("is idempotent — running twice produces same result", async () => {
		const prereq = {
			tool: "echo",
			installCmd: "echo noop",
			detectCmd: "echo ok",
			authDetectCmd: "echo ok",
		};
		const first = await setupTool(prereq);
		clearPrerequisiteCache();
		const second = await setupTool(prereq);
		expect(first.wasInstalled).toBe(second.wasInstalled);
		expect(first.authenticated).toBe(second.authenticated);
	});

	it("reports install failure for missing tool", async () => {
		const result = await installTool("__xcsh_fake_brew__ install fake", { maxRetries: 0 });
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("returns authLoginCmd when tool installed but not authenticated", async () => {
		const result = await setupTool({
			tool: "echo",
			installCmd: "echo noop",
			detectCmd: "echo ok",
			authDetectCmd: "false",
			authLoginCmd: "echo login",
		});
		expect(result.authenticated).toBe(false);
		expect(result.authLoginCmd).toBe("echo login");
	});
});

// ── checkPrerequisite (existing tests) ───────────────────────────────────────

describe("checkPrerequisite", () => {
	it("returns true for a command that exists and exits 0", async () => {
		const result = await checkPrerequisite("echo hello");
		expect(result).toBe(true);
	});

	it("returns false for a command that does not exist", async () => {
		const result = await checkPrerequisite("__xcsh_nonexistent_tool_abc123__ --version");
		expect(result).toBe(false);
	});

	it("returns false for a command that exits non-zero", async () => {
		const result = await checkPrerequisite("false");
		expect(result).toBe(false);
	});

	it("caches results across calls", async () => {
		const first = await checkPrerequisite("echo cached");
		const second = await checkPrerequisite("echo cached");
		expect(first).toBe(true);
		expect(second).toBe(true);
	});

	it("clearPrerequisiteCache resets the cache", async () => {
		await checkPrerequisite("echo clear-test");
		clearPrerequisiteCache();
		const result = await checkPrerequisite("echo clear-test");
		expect(result).toBe(true);
	});
});

// ── checkAllPrerequisites (existing tests) ───────────────────────────────────

describe("checkAllPrerequisites", () => {
	it("returns available: true for plugins with no prerequisites", async () => {
		const plugins: MarketplacePluginEntry[] = [{ name: "no-prereqs", source: "./plugins/no-prereqs" }];
		const results = await checkAllPrerequisites(plugins);
		expect(results.get("no-prereqs")).toEqual({ available: true, missing: [] });
	});

	it("returns available: true for plugins with empty prerequisites array", async () => {
		const plugins: MarketplacePluginEntry[] = [
			{ name: "empty-prereqs", source: "./plugins/empty", prerequisites: [] },
		];
		const results = await checkAllPrerequisites(plugins);
		expect(results.get("empty-prereqs")).toEqual({ available: true, missing: [] });
	});

	it("returns available: true when all prerequisites are met", async () => {
		const plugins: MarketplacePluginEntry[] = [
			{
				name: "all-met",
				source: "./plugins/all-met",
				prerequisites: [{ tool: "echo", installCmd: "brew install echo", detectCmd: "echo test" }],
			},
		];
		const results = await checkAllPrerequisites(plugins);
		expect(results.get("all-met")).toEqual({ available: true, missing: [] });
	});

	it("returns missing tools when prerequisites are not met", async () => {
		const plugins: MarketplacePluginEntry[] = [
			{
				name: "missing-tool",
				source: "./plugins/missing",
				prerequisites: [
					{ tool: "fake-tool", installCmd: "brew install fake-tool", detectCmd: "__xcsh_fake_tool__ --version" },
				],
			},
		];
		const results = await checkAllPrerequisites(plugins);
		const result = results.get("missing-tool");
		expect(result?.available).toBe(false);
		expect(result?.missing).toEqual(["fake-tool"]);
	});

	it("handles mixed available and missing prerequisites", async () => {
		const plugins: MarketplacePluginEntry[] = [
			{
				name: "mixed",
				source: "./plugins/mixed",
				prerequisites: [
					{ tool: "echo", installCmd: "brew install echo", detectCmd: "echo ok" },
					{ tool: "missing", installCmd: "brew install missing", detectCmd: "__xcsh_missing__ --v" },
				],
			},
		];
		const results = await checkAllPrerequisites(plugins);
		const result = results.get("mixed");
		expect(result?.available).toBe(false);
		expect(result?.missing).toEqual(["missing"]);
	});

	it("checks multiple plugins independently", async () => {
		const plugins: MarketplacePluginEntry[] = [
			{
				name: "available-plugin",
				source: "./plugins/a",
				prerequisites: [{ tool: "echo", installCmd: "brew install echo", detectCmd: "echo x" }],
			},
			{
				name: "unavailable-plugin",
				source: "./plugins/b",
				prerequisites: [{ tool: "nope", installCmd: "brew install nope", detectCmd: "__xcsh_nope__" }],
			},
		];
		const results = await checkAllPrerequisites(plugins);
		expect(results.get("available-plugin")?.available).toBe(true);
		expect(results.get("unavailable-plugin")?.available).toBe(false);
	});
});
