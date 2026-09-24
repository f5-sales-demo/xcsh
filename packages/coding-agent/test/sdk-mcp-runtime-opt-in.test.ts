import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Settings } from "../src/config/settings";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

const fixture = path.join(import.meta.dir, "fixtures", "terminal-uat-mcp-server.mjs");

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error("Timed out waiting for synthetic MCP lifecycle evidence");
}

describe("SDK MCP runtime opt-in", () => {
	let cwd = "";
	let eventsPath = "";

	beforeEach(async () => {
		cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xcsh-sdk-mcp-runtime-"));
		eventsPath = path.join(cwd, "mcp-events.log");
		await fs.promises.mkdir(path.join(cwd, ".xcsh"));
		await fs.promises.writeFile(
			path.join(cwd, ".xcsh", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					synthetic: {
						type: "stdio",
						command: process.execPath,
						args: [fixture],
						env: { XCSH_MCP_TEST_EVENTS: eventsPath },
					},
				},
			}),
		);
	});

	afterEach(async () => {
		await fs.promises.rm(cwd, { recursive: true, force: true });
	});

	function options() {
		return {
			cwd,
			agentDir: cwd,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "mcp.notifications": true }),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
			toolNames: ["read"],
		};
	}

	test("omission leaves configured servers undiscovered and unstarted", async () => {
		const result = await createAgentSession(options());
		try {
			expect(result.mcpRuntime?.enabled).toBe(false);
			expect(result.mcpManager).toBeUndefined();
			expect(fs.existsSync(eventsPath)).toBe(false);
			expect(result.session.getAllToolNames().some(name => name.startsWith("mcp_"))).toBe(false);
		} finally {
			await result.session.dispose();
		}
	});

	test("a live opt-in publishes and then fully removes one session-owned runtime", async () => {
		const result = await createAgentSession(options());
		try {
			await result.mcpRuntime!.setEnabled(true);
			expect(result.mcpManager?.getConnectedServers()).toEqual(["synthetic"]);
			expect(result.session.getAllToolNames()).toContain("mcp_synthetic_read");
			expect(
				result.session.customCommands.some(command => command.command.name === "synthetic:synthetic_prompt"),
			).toBe(true);
			expect(result.session.systemPrompt).toContain("Synthetic MCP server instruction");
			expect(result.mcpManager?.getServerResources("synthetic")?.resources[0]?.uri).toBe("fixture://value");

			await result.mcpRuntime!.setEnabled(false);
			await waitFor(() => fs.existsSync(eventsPath) && /(?:sigterm|eof):/.test(fs.readFileSync(eventsPath, "utf8")));

			expect(result.mcpManager).toBeUndefined();
			expect(result.session.getAllToolNames().some(name => name.startsWith("mcp_"))).toBe(false);
			expect(
				result.session.customCommands.some(command => command.command.name === "synthetic:synthetic_prompt"),
			).toBe(false);
			expect(result.session.systemPrompt).not.toContain("Synthetic MCP server instruction");
			const events = fs.readFileSync(eventsPath, "utf8");
			expect(events.match(/^start:/gm)).toHaveLength(1);
		} finally {
			await result.session.dispose();
		}
	}, 15_000);
});
