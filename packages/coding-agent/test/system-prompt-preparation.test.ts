import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { clearCache as clearCapabilityFsCache } from "../src/capability/fs";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { Settings } from "../src/config/settings";
import { clearXcshPluginRootsCache, getXcshPluginCacheGeneration } from "../src/discovery/helpers";
import type { StartFolder } from "../src/discovery/start-folder";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";
import {
	assertPreparedSystemPromptCwd,
	prepareSystemPromptInputs,
	renderSystemPrompt,
	type SystemPromptPreparationDependencies,
	type SystemPromptPreparationDiagnostic,
} from "../src/system-prompt";

const CONTEXT_SENTINEL = "CONTEXT_PREPARATION_SENTINEL";
const AGENTS_SENTINEL = "nested/AGENTS_PREPARATION_SENTINEL/XCSH.md";
const PLUGIN_SENTINEL = "plugin-preparation-sentinel";

function dependencies(
	overrides: Partial<SystemPromptPreparationDependencies> = {},
): SystemPromptPreparationDependencies {
	return {
		resolvePromptInput: async input => input,
		loadSystemPromptFiles: async () => null,
		loadProjectContextFiles: async () => [{ path: "XCSH.md", content: CONTEXT_SENTINEL, depth: 0 }],
		buildAgentsMdSearch: async () => ({
			scopePath: ".",
			limit: 200,
			pattern: "XCSH.md depth 1-4",
			files: [AGENTS_SENTINEL],
		}),
		loadSkills: async () => ({ skills: [], warnings: [] }),
		loadPluginSummaries: async () => ({
			summaries: [{ id: PLUGIN_SENTINEL, name: PLUGIN_SENTINEL, description: "test plugin" }],
			cacheStatus: "completed",
		}),
		getEnvironmentInfo: async () => [{ label: "OS", value: "test" }],
		resolveStartFolder: async () => ({ kind: "plain" }),
		...overrides,
	};
}

describe("system prompt preparation", () => {
	beforeAll(() => registerCodingAgentPromptHelpers());

	test("retains completed stages, names the timed-out stage, aborts it, and renders the retained context", async () => {
		let cancellationObserved = false;
		const diagnostics: SystemPromptPreparationDiagnostic[] = [];
		const deps = dependencies({
			loadSystemPromptFiles: async signal =>
				await new Promise<string | null>((_resolve, reject) => {
					signal.addEventListener(
						"abort",
						() => {
							cancellationObserved = true;
							reject(signal.reason);
						},
						{ once: true },
					);
				}),
		});

		const snapshot = await prepareSystemPromptInputs(
			{ cwd: "/tmp/prompt-preparation", timeoutMs: 20, onDiagnostic: diagnostic => diagnostics.push(diagnostic) },
			deps,
		);
		const rendered = renderSystemPrompt(snapshot, {
			tools: new Map([["read", { label: "Read", description: "Read files" }]]),
		});

		expect(cancellationObserved).toBe(true);
		expect(rendered).toContain(CONTEXT_SENTINEL);
		expect(rendered).toContain(AGENTS_SENTINEL);
		expect(rendered).toContain(`xcsh://plugin/${PLUGIN_SENTINEL}`);
		expect(snapshot.stages.find(stage => stage.name === "system_prompt")?.outcome).toBe("timed_out");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.stages.filter(stage => stage.outcome === "timed_out").map(stage => stage.name)).toEqual([
			"system_prompt",
		]);
		expect(JSON.stringify(diagnostics[0])).not.toContain("/tmp/prompt-preparation");
	});

	test("one failed stage does not discard successful stages", async () => {
		const snapshot = await prepareSystemPromptInputs(
			{ cwd: "/tmp/prompt-failure", timeoutMs: 100 },
			dependencies({ loadSystemPromptFiles: async () => Promise.reject(new Error("fixture failure")) }),
		);
		const rendered = renderSystemPrompt(snapshot, {
			tools: new Map([["read", { label: "Read", description: "Read files" }]]),
		});

		expect(snapshot.stages.find(stage => stage.name === "system_prompt")?.outcome).toBe("failed");
		expect(rendered).toContain(CONTEXT_SENTINEL);
		expect(rendered).toContain(AGENTS_SENTINEL);
		expect(rendered).toContain(`xcsh://plugin/${PLUGIN_SENTINEL}`);
	});

	test("one immutable preparation supports repeated tool-set renders without reloading", async () => {
		let loads = 0;
		const count =
			<T>(value: T) =>
			async () => {
				loads += 1;
				return value;
			};
		const snapshot = await prepareSystemPromptInputs(
			{ cwd: "/tmp/prompt-hoisting", timeoutMs: 100 },
			dependencies({
				loadSystemPromptFiles: count(null),
				loadProjectContextFiles: count([{ path: "XCSH.md", content: CONTEXT_SENTINEL, depth: 0 }]),
				buildAgentsMdSearch: count({
					scopePath: ".",
					limit: 200,
					pattern: "XCSH.md depth 1-4",
					files: [AGENTS_SENTINEL],
				}),
				loadSkills: count({ skills: [], warnings: [] }),
				loadPluginSummaries: count({ summaries: [], cacheStatus: "completed" as const }),
				getEnvironmentInfo: count([]),
				resolveStartFolder: count({ kind: "plain" } satisfies StartFolder),
			}),
		);

		const first = renderSystemPrompt(snapshot, { toolNames: ["read"] });
		const second = renderSystemPrompt(snapshot, { toolNames: ["read", "snapshot_tool"] });
		expect(first).not.toContain("`snapshot_tool`");
		expect(second).toContain("`snapshot_tool`");
		expect(loads).toBe(7);
	});

	test("rejects a shared snapshot when the effective cwd differs", async () => {
		const snapshot = await prepareSystemPromptInputs({ cwd: "/tmp/workspace-a", timeoutMs: 100 }, dependencies());
		expect(() => assertPreparedSystemPromptCwd(snapshot, "/tmp/workspace-b")).toThrow("working directory");
	});
});

describe("session prompt snapshot lifecycle", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		clearCapabilityFsCache();
		clearXcshPluginRootsCache();
		for (const tempDir of tempDirs.splice(0)) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const createSession = async (cwd: string, sessionManager = SessionManager.inMemory(cwd)) => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) throw new Error("Expected bundled test model");
		return await createAgentSession({
			cwd,
			agentDir: cwd,
			sessionManager,
			settings: Settings.isolated(),
			model,
			disableExtensionDiscovery: true,
			skills: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			toolNames: ["read"],
		});
	};

	test("ordinary tool refreshes retain the snapshot while plugin invalidation replaces it", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-prompt-snapshot-"));
		tempDirs.push(cwd);
		fs.writeFileSync(path.join(cwd, "XCSH.md"), "PROMPT_SNAPSHOT_A");
		const { session } = await createSession(cwd);
		try {
			expect(session.systemPrompt).toContain("PROMPT_SNAPSHOT_A");
			fs.writeFileSync(path.join(cwd, "XCSH.md"), "PROMPT_SNAPSHOT_B");
			await session.setActiveToolsByName(["read"]);
			expect(session.systemPrompt).toContain("PROMPT_SNAPSHOT_A");
			expect(session.systemPrompt).not.toContain("PROMPT_SNAPSHOT_B");

			clearCapabilityFsCache();
			clearXcshPluginRootsCache();
			await session.refreshBaseSystemPrompt();
			expect(session.systemPrompt).toContain("PROMPT_SNAPSHOT_B");
			expect(session.systemPrompt).not.toContain("PROMPT_SNAPSHOT_A");
		} finally {
			await session.dispose();
		}
	});

	test("eight concurrent child sessions share one preparation and retain every sentinel", async () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-prompt-children-"));
		tempDirs.push(cwd);
		let loads = 0;
		const count =
			<T>(value: T) =>
			async () => {
				loads += 1;
				return value;
			};
		const snapshot = await prepareSystemPromptInputs(
			{ cwd, timeoutMs: 100 },
			dependencies({
				loadSystemPromptFiles: count(null),
				loadProjectContextFiles: count([{ path: "XCSH.md", content: CONTEXT_SENTINEL, depth: 0 }]),
				buildAgentsMdSearch: count({
					scopePath: ".",
					limit: 200,
					pattern: "XCSH.md depth 1-4",
					files: [AGENTS_SENTINEL],
				}),
				loadSkills: count({ skills: [], warnings: [] }),
				loadPluginSummaries: count({
					summaries: [{ id: PLUGIN_SENTINEL, name: PLUGIN_SENTINEL, description: "test plugin" }],
					cacheStatus: "completed" as const,
					generation: getXcshPluginCacheGeneration(),
				}),
				getEnvironmentInfo: count([]),
				resolveStartFolder: count({ kind: "plain" } satisfies StartFolder),
			}),
		);
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) throw new Error("Expected bundled test model");
		const results = await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				createAgentSession({
					cwd,
					agentDir: cwd,
					sessionManager: SessionManager.inMemory(cwd),
					settings: Settings.isolated(),
					model,
					disableExtensionDiscovery: true,
					preparedSystemPromptInputs: snapshot,
					promptTemplates: [],
					slashCommands: [],
					enableMCP: false,
					enableLsp: false,
					toolNames: ["read", "todo_write"],
					excludedToolNames: ["todo_write"],
					systemPrompt: defaultPrompt => `${defaultPrompt}\nCHILD_PROMPT_${index}`,
				}),
			),
		);
		try {
			expect(loads).toBe(7);
			for (const [index, { session }] of results.entries()) {
				expect(session.systemPrompt).toContain(CONTEXT_SENTINEL);
				expect(session.systemPrompt).toContain(AGENTS_SENTINEL);
				expect(session.systemPrompt).toContain(`xcsh://plugin/${PLUGIN_SENTINEL}`);
				expect(session.systemPrompt).toContain(`CHILD_PROMPT_${index}`);
				expect(session.getActiveToolNames()).not.toContain("todo_write");
			}
		} finally {
			await Promise.all(results.map(({ session }) => session.dispose()));
		}
	});

	test("reviewed session relocation replaces a snapshot from the previous cwd", async () => {
		const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-prompt-relocate-a-"));
		const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-prompt-relocate-b-"));
		tempDirs.push(cwdA, cwdB);
		fs.writeFileSync(path.join(cwdA, "XCSH.md"), "PROMPT_RELOCATION_A");
		fs.writeFileSync(path.join(cwdB, "XCSH.md"), "PROMPT_RELOCATION_B");
		const sessionManager = SessionManager.inMemory(cwdA);
		const { session } = await createSession(cwdA, sessionManager);
		try {
			expect(session.systemPrompt).toContain("PROMPT_RELOCATION_A");
			await sessionManager.moveTo(cwdB);
			await session.refreshBaseSystemPrompt();
			expect(session.systemPrompt).toContain("PROMPT_RELOCATION_B");
			expect(session.systemPrompt).not.toContain("PROMPT_RELOCATION_A");
		} finally {
			await session.dispose();
		}
	});
});
