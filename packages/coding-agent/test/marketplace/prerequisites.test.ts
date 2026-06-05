import { afterEach, describe, expect, it } from "bun:test";

import {
	checkAllPrerequisites,
	checkPrerequisite,
	clearPrerequisiteCache,
} from "@f5xc-salesdemos/xcsh/extensibility/plugins/marketplace/prerequisites";
import type { MarketplacePluginEntry } from "@f5xc-salesdemos/xcsh/extensibility/plugins/marketplace/types";

afterEach(() => {
	clearPrerequisiteCache();
});

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
