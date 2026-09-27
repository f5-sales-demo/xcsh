import { describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { parseArgs } from "../src/cli/args";
import { Settings } from "../src/config/settings";
import { InternalUrlRouter } from "../src/internal-urls/router";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";
import { getBuiltinSlashCommandInventory } from "../src/slash-commands/builtin-registry";

const sourceRoot = path.resolve(import.meta.dir, "..", "src");

describe("MCP clean-removal contract", () => {
	it("ships no MCP runtime, configuration discovery, or protocol surface", () => {
		for (const relativePath of [
			"mcp",
			"capability/mcp.ts",
			"config/mcp-schema.json",
			"discovery/mcp-json.ts",
			"internal-urls/mcp-protocol.ts",
			"modes/controllers/mcp-command-controller.ts",
			"modes/components/mcp-add-wizard.ts",
		]) {
			expect(existsSync(path.join(sourceRoot, relativePath))).toBe(false);
		}
		expect(parseArgs(["--mcp"]).unrecognizedFlags).toEqual([{ token: "--mcp", name: "mcp" }]);
		expect(getBuiltinSlashCommandInventory().map(command => command.name)).not.toContain("mcp");
		const router = new InternalUrlRouter();
		expect(router.canHandle("mcp://sentinel")).toBe(false);
	});

	it("treats a project .mcp.json as inert and never launches its sentinel process", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "xcsh-mcp-removal-"));
		const sentinel = path.join(root, "sentinel");
		writeFileSync(
			path.join(root, ".mcp.json"),
			JSON.stringify({ mcpServers: { sentinel: { command: "touch", args: [sentinel] } } }),
		);
		const { session } = await createAgentSession({
			cwd: root,
			agentDir: path.join(root, "agent"),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});
		try {
			await Bun.sleep(100);
			expect(existsSync(sentinel)).toBe(false);
		} finally {
			await session.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
