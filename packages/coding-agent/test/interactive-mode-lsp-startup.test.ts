import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { registerLocales, TempDir } from "@f5-sales-demo/pi-utils";
import { locales } from "../src/locales/index";

registerLocales(locales);

import { ModelRegistry } from "../src/config/model-registry";
import { _resetSettingsForTest, Settings } from "../src/config/settings";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

describe("InteractiveMode welcome banner status checks", () => {
	let authStorage: AuthStorage;
	let eventBus: EventBus;
	let mode: InteractiveMode;
	let session: AgentSession;
	let tempDir: TempDir;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
		vi.spyOn(process.stdin, "resume").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "pause").mockReturnValue(process.stdin);
		vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
		if (typeof process.stdin.setRawMode === "function") {
			vi.spyOn(process.stdin, "setRawMode").mockReturnValue(process.stdin);
		}

		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-interactive-mode-welcome-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		// Register an in-memory provider credential so hasActiveLlmProvider() is true
		// regardless of ambient env. Otherwise the banner renders the "no LLM provider
		// — run /login" gate (which contains "Model Provider"), failing this test on any
		// runner without an ANTHROPIC_API_KEY (e.g. CI). No network — init only does the
		// instant local credential check. (#1903)
		authStorage.setRuntimeApiKey("anthropic", "sk-ant-test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");

		session = new AgentSession({
			agent: new Agent({
				initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		eventBus = new EventBus();
		mode = new InteractiveMode(session, "test", () => {}, undefined, undefined, eventBus);
	});

	afterEach(async () => {
		mode?.stop();
		vi.restoreAllMocks();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("renders the logo + version banner with no status panel after init", async () => {
		await mode.init();
		const output = Bun.stripANSI(mode.ui.render(120).join("\n"));
		expect(output).toContain("xcsh vtest");
		// The status panel is gone — provider/context status live in on-demand commands.
		expect(output).not.toContain("Model Provider");
		expect(output).not.toContain("F5 XC Context");
	}, 30_000);

	it("does not render old Tips/LSP/Sessions sections", async () => {
		await mode.init();
		const output = Bun.stripANSI(mode.ui.render(120).join("\n"));
		expect(output).not.toContain("Tips");
		expect(output).not.toContain("LSP Servers");
		expect(output).not.toContain("Recent sessions");
	}, 30_000);
});
