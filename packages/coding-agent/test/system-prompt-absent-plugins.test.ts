import { describe, expect, it } from "bun:test";
import { buildSystemPromptToolMetadata } from "@f5-sales-demo/xcsh/system-prompt";

describe("system prompt with absent plugins", () => {
	it("does not list tools that are not registered", () => {
		// Build a tools map that only contains built-in tools (no sf_setup)
		const tools = new Map<string, { name: string; label?: string; description?: string }>([
			["bash", { name: "bash", label: "Bash", description: "Execute shell commands" }],
			["read", { name: "read", label: "Read", description: "Read files" }],
		]);
		const metadata = buildSystemPromptToolMetadata(tools as any);

		// sf_setup should not appear since it was never registered
		expect(metadata.has("sf_setup")).toBe(false);
		expect(metadata.has("sf_login")).toBe(false);

		// Only the registered tools should be present
		expect(metadata.has("bash")).toBe(true);
		expect(metadata.has("read")).toBe(true);
		expect(metadata.size).toBe(2);
	});

	it("only includes explicitly registered tools in metadata", () => {
		const tools = new Map<string, { name: string; label?: string; description?: string }>([
			["bash", { name: "bash", label: "Bash", description: "Execute shell commands" }],
			["edit", { name: "edit", label: "Edit", description: "Edit files" }],
			["write", { name: "write", label: "Write", description: "Write files" }],
		]);
		const metadata = buildSystemPromptToolMetadata(tools as any);

		// Verify no plugin tools leak through
		const pluginToolNames = ["sf_setup", "sf_login", "sf_query", "gitlab_login"];
		for (const name of pluginToolNames) {
			expect(metadata.has(name)).toBe(false);
		}

		// Only the three registered tools should be present
		expect(metadata.size).toBe(3);
	});

	it("registered plugin tool appears in metadata", () => {
		const tools = new Map<string, { name: string; label?: string; description?: string }>([
			["bash", { name: "bash", label: "Bash", description: "Execute shell commands" }],
			["sf_setup", { name: "sf_setup", label: "Salesforce Setup", description: "Configure Salesforce" }],
		]);
		const metadata = buildSystemPromptToolMetadata(tools as any);

		expect(metadata.has("sf_setup")).toBe(true);
		expect(metadata.get("sf_setup")?.label).toBe("Salesforce Setup");
		expect(metadata.size).toBe(2);
	});
});
