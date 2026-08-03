import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { Settings } from "../src/config/settings";
import { createAgentSession, type ExtensionFactory } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

const toolActivationExtension: ExtensionFactory = pi => {
	pi.registerTool({
		name: "default_inactive_tool",
		label: "Default Inactive Tool",
		description: "Tool hidden from the initial active set unless explicitly requested.",
		parameters: Type.Object({}),
		defaultInactive: true,
		async execute() {
			return { content: [{ type: "text", text: "inactive" }] };
		},
	});
	pi.registerTool({
		name: "default_active_tool",
		label: "Default Active Tool",
		description: "Tool included in the initial active set.",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "active" }] };
		},
	});
};

describe("createAgentSession defaultInactive tool activation", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("excludes defaultInactive extension tools from the initial active set unless explicitly requested", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [toolActivationExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			expect(session.getAllToolNames()).toEqual(
				expect.arrayContaining(["default_active_tool", "default_inactive_tool"]),
			);
			expect(session.getActiveToolNames()).toContain("default_active_tool");
			expect(session.getActiveToolNames()).not.toContain("default_inactive_tool");
			expect(session.systemPrompt).toContain("default_active_tool");
			expect(session.systemPrompt).not.toContain("default_inactive_tool");
		} finally {
			await session.dispose();
		}
	});

	it("allows explicitly requested defaultInactive extension tools into the initial active set", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [toolActivationExtension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			toolNames: ["read", "default_inactive_tool"],
		});

		try {
			expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", "default_inactive_tool"]));
			expect(session.getActiveToolNames()).not.toContain("default_active_tool");
			expect(session.systemPrompt).toContain("default_inactive_tool");
			expect(session.systemPrompt).not.toContain("default_active_tool");
		} finally {
			await session.dispose();
		}
	});

	it("does not register the bundled image tool when the explicit tool scope is empty", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		const savedGeminiApiKey = Bun.env.GEMINI_API_KEY;
		Bun.env.GEMINI_API_KEY = "benchmark-scope-test";

		try {
			const { session } = await createAgentSession({
				cwd: tempDir,
				agentDir: tempDir,
				sessionManager: SessionManager.inMemory(),
				settings: Settings.isolated(),
				model: getBundledModel("openai", "gpt-4o-mini"),
				disableExtensionDiscovery: true,
				skills: [],
				contextFiles: [],
				promptTemplates: [],
				slashCommands: [],
				enableMCP: false,
				enableLsp: false,
				toolNames: [],
			});
			try {
				expect(session.getAllToolNames()).not.toContain("generate_image");
				expect(session.getActiveToolNames()).not.toContain("generate_image");
			} finally {
				await session.dispose();
			}
		} finally {
			if (savedGeminiApiKey === undefined) {
				delete Bun.env.GEMINI_API_KEY;
			} else {
				Bun.env.GEMINI_API_KEY = savedGeminiApiKey;
			}
		}
	});
});
