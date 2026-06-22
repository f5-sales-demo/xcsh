/**
 * XCSH.md is the agent initialization file.
 *
 * xcsh is a purpose-built network/SE assistant, not a developer tool, so it
 * initializes from its own XCSH.md instead of developer-tool init files
 * (AGENTS.md / CLAUDE.md / GEMINI.md). These tests lock in that contract under
 * the *production default* provider configuration (every provider disabled
 * except `native` and `agents-md`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ContextFile, contextFileCapability } from "@f5xc-salesdemos/xcsh/capability/context-file";
import { SETTINGS_SCHEMA } from "@f5xc-salesdemos/xcsh/config/settings-schema";
import { loadCapability, setDisabledProviders } from "@f5xc-salesdemos/xcsh/discovery";
import { SOURCE_PATHS } from "@f5xc-salesdemos/xcsh/discovery/helpers";
import { buildSystemPrompt, loadProjectContextFiles } from "@f5xc-salesdemos/xcsh/system-prompt";
import { registerCodingAgentPromptHelpers } from "../../src/config/prompt-templates";

const DEFAULT_DISABLED = SETTINGS_SCHEMA.disabledProviders.default as string[];

describe("XCSH.md is the agent init file", () => {
	let tempDir = "";
	let tempHomeDir = "";
	let originalHome: string | undefined;

	beforeAll(() => {
		// Register the Handlebars helpers the system-prompt template depends on
		// (production registers these at startup).
		registerCodingAgentPromptHelpers();
	});

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-initfile-"));
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-initfile-home-"));
		originalHome = process.env.HOME;
		process.env.HOME = tempHomeDir;
		vi.spyOn(os, "homedir").mockReturnValue(tempHomeDir);
		// Reproduce the production default: everything disabled except `native`
		// and `agents-md` (the latter is what this change enables).
		setDisabledProviders([...DEFAULT_DISABLED]);
	});

	afterEach(() => {
		setDisabledProviders([]);
		vi.restoreAllMocks();
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
		if (tempHomeDir) fs.rmSync(tempHomeDir, { recursive: true, force: true });
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
	});

	it("enables the repo-root reader (agents-md) by default while keeping foreign tools disabled", () => {
		expect(DEFAULT_DISABLED).not.toContain("agents-md");
		expect(DEFAULT_DISABLED).toContain("gemini");
		expect(DEFAULT_DISABLED).toContain("codex");
		expect(DEFAULT_DISABLED).toContain("github");
		expect(DEFAULT_DISABLED).toContain("xcsh");
	});

	it("native provider loads project .xcsh/XCSH.md", async () => {
		const configDir = path.join(tempDir, SOURCE_PATHS.native.projectDir);
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, "XCSH.md"), "PROJECT_XCSH_MARKER");

		const result = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });
		const item = result.items.find(i => i.path === path.join(configDir, "XCSH.md"));
		expect(item?.content).toBe("PROJECT_XCSH_MARKER");
	});

	it("native provider loads user ~/.xcsh/agent/XCSH.md", async () => {
		const userDir = path.join(tempHomeDir, SOURCE_PATHS.native.userAgent);
		fs.mkdirSync(userDir, { recursive: true });
		fs.writeFileSync(path.join(userDir, "XCSH.md"), "USER_XCSH_MARKER");

		const result = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });
		const userItem = result.items.find(i => i.level === "user");
		expect(userItem?.path).toBe(path.join(userDir, "XCSH.md"));
		expect(userItem?.content).toBe("USER_XCSH_MARKER");
	});

	it("ignores a legacy .xcsh/AGENTS.md", async () => {
		const configDir = path.join(tempDir, SOURCE_PATHS.native.projectDir);
		fs.mkdirSync(configDir, { recursive: true });
		fs.writeFileSync(path.join(configDir, "AGENTS.md"), "LEGACY_SHOULD_BE_IGNORED");

		const result = await loadCapability<ContextFile>(contextFileCapability.id, { cwd: tempDir });
		expect(result.items).toHaveLength(0);
	});

	it("discovers a repo-root XCSH.md by default", async () => {
		fs.writeFileSync(path.join(tempDir, "XCSH.md"), "ROOT_XCSH_MARKER");

		const files = await loadProjectContextFiles({ cwd: tempDir });
		expect(files.map(f => f.path)).toContain(path.join(tempDir, "XCSH.md"));
	});

	it("ignores a repo-root AGENTS.md", async () => {
		fs.writeFileSync(path.join(tempDir, "AGENTS.md"), "LEGACY_ROOT_IGNORED");

		const files = await loadProjectContextFiles({ cwd: tempDir });
		expect(files.map(f => f.path)).not.toContain(path.join(tempDir, "AGENTS.md"));
	});

	it("injects repo-root XCSH.md content into the system prompt <context> block", async () => {
		fs.writeFileSync(path.join(tempDir, "XCSH.md"), "XCSH_CONTEXT_MARKER_42");

		const prompt = await buildSystemPrompt({ cwd: tempDir, skills: [], rules: [], toolNames: [] });
		expect(prompt).toContain("XCSH_CONTEXT_MARKER_42");
	});

	it("advertises a nested XCSH.md in <dir-context> but not a nested AGENTS.md", async () => {
		const sub = path.join(tempDir, "service");
		fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(path.join(sub, "XCSH.md"), "# service rules");
		fs.writeFileSync(path.join(sub, "AGENTS.md"), "# legacy service rules");

		const prompt = await buildSystemPrompt({ cwd: tempDir, skills: [], rules: [], toolNames: [] });
		expect(prompt).toContain("service/XCSH.md");
		expect(prompt).not.toContain("service/AGENTS.md");
	});
});
