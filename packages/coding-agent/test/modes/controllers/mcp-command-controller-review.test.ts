import { afterEach, beforeAll, beforeEach, expect, test, vi } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { getAgentDir, getMCPConfigPath, getProjectDir, setAgentDir, setProjectDir } from "@f5-sales-demo/pi-utils";
import { addMCPServer, readMCPConfigFile } from "../../../src/mcp/config-writer";
import { MCPCommandController } from "../../../src/modes/controllers/mcp-command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
let directory = "";
let originalProject = "";
let originalAgentDir = "";

beforeEach(async () => {
	originalProject = getProjectDir();
	originalAgentDir = getAgentDir();
	directory = await mkdtemp(join(tmpdir(), "xcsh-mcp-review-"));
	await mkdir(join(directory, "project"), { recursive: true });
	setAgentDir(join(directory, "agent"));
	setProjectDir(join(directory, "project"));
});

afterEach(async () => {
	setProjectDir(originalProject);
	setAgentDir(originalAgentDir);
	await rm(directory, { recursive: true, force: true });
});

function harness(inputs: string[][]) {
	const screens: string[] = [];
	let current: Component | undefined;
	const ctx = {
		editor: { onEscape: undefined, addToHistory: vi.fn(), setText: vi.fn() },
		editorContainer: { clear: vi.fn(), addChild: vi.fn() },
		chatContainer: { addChild: vi.fn() },
		ui: { terminal: { rows: 24 }, setFocus: vi.fn(), requestRender: vi.fn() },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn(),
		session: {
			modelRegistry: {
				authStorage: {
					has: vi.fn(() => false),
					set: vi.fn(async () => {}),
					remove: vi.fn(async () => {}),
				},
			},
			refreshMCPTools: vi.fn(async () => {}),
			getActiveToolNames: vi.fn(() => []),
			getToolByName: vi.fn(),
			setActiveToolsByName: vi.fn(async () => {}),
		},
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (result: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				current = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				screens.push(Bun.stripANSI(current.render(80).join("\n")));
				for (const input of inputs.shift() ?? []) current.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		screens,
		controller: new MCPCommandController(ctx),
		input: (value: string) => current?.handleInput?.(value),
		text: () => Bun.stripANSI(current?.render(80).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected MCP review state was not rendered");
}

test("typed MCP quick-add is Cancel-first and does not write configuration", async () => {
	const h = harness([["\r"]]);
	const path = getMCPConfigPath("project", getProjectDir());
	await h.controller.handle("/mcp add edge --scope project -- synthetic-server --flag");
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeUndefined();
	expect(h.screens[0]).toContain("Review MCP server addition");
	expect(h.screens[0]).toContain("mcp-server:project:edge");
	expect(h.screens[0]).toContain("Connectivity");
	expect(h.screens[0]).toContain("testing and runtime connection are separate");
});

test("confirmed MCP quick-add persists exact config before reporting runtime state", async () => {
	const h = harness([["\x1b[B", "\r"]]);
	const path = getMCPConfigPath("project", getProjectDir());
	await h.controller.handle("/mcp add edge --scope project -- synthetic-server --flag");
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toEqual({
		type: "stdio",
		command: "synthetic-server",
		args: ["--flag"],
	});
	expect(h.ctx.showStatus).toHaveBeenCalledWith(
		'Saved MCP server "edge" in project configuration. Runtime: not connected.',
	);
});

test("MCP add renews review after unrelated config drift", async () => {
	const h = harness([]);
	const path = getMCPConfigPath("project", getProjectDir());
	const pending = h.controller.handle("/mcp add edge --scope project -- synthetic-server");
	await waitFor(() => h.screens.length === 1);
	await addMCPServer(path, "other", { type: "stdio", command: "other-server" });
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeUndefined();
	h.input("\r");
	await pending;
});

test("MCP add keeps a failed config write unresolved and retries only the write", async () => {
	const h = harness([]);
	const configDir = join(getProjectDir(), ".xcsh");
	const path = getMCPConfigPath("project", getProjectDir());
	await mkdir(configDir, { recursive: true });
	const pending = h.controller.handle("/mcp add edge --scope project -- synthetic-server --flag");
	await waitFor(() => h.screens.length === 1);
	await chmod(configDir, 0o500);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("EACCES") || h.text().includes("permission denied"));
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeUndefined();
	expect(h.text()).toContain("Retry change");

	await chmod(configDir, 0o700);
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toEqual({
		type: "stdio",
		command: "synthetic-server",
		args: ["--flag"],
	});
});

test("MCP enabled state and removal each require exact reviewed mutations", async () => {
	const path = getMCPConfigPath("project", getProjectDir());
	await addMCPServer(path, "edge", { type: "stdio", command: "synthetic-server" });

	const disableCancelled = harness([["\r"]]);
	await disableCancelled.controller.handle("/mcp disable edge");
	expect((await readMCPConfigFile(path)).mcpServers?.edge?.enabled).toBeUndefined();
	expect(disableCancelled.screens[0]).toContain("Enabled → Disabled");

	const disableConfirmed = harness([["\x1b[B", "\r"]]);
	await disableConfirmed.controller.handle("/mcp disable edge");
	expect((await readMCPConfigFile(path)).mcpServers?.edge?.enabled).toBe(false);

	const removeCancelled = harness([["\r"]]);
	await removeCancelled.controller.handle("/mcp remove edge --scope project");
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeDefined();

	const removeConfirmed = harness([["\x1b[B", "\r"]]);
	await removeConfirmed.controller.handle("/mcp remove edge --scope project");
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeUndefined();
});

test("MCP removal preserves the saved outcome while reporting credential cleanup and runtime refresh failures", async () => {
	const path = getMCPConfigPath("project", getProjectDir());
	await addMCPServer(path, "edge", {
		type: "http",
		url: "https://edge.example.invalid/mcp",
		auth: {
			type: "oauth",
			credentialId: "mcp_oauth_edge",
			tokenUrl: "https://auth.example.invalid/token",
		},
	});
	const h = harness([["\x1b[B", "\r"]]);
	h.ctx.session.modelRegistry.authStorage.remove = vi.fn(async () => {
		throw new Error("synthetic credential cleanup failure");
	});
	h.ctx.mcpManager = {
		getConnection: vi.fn(() => undefined),
		disconnectAll: vi.fn(async () => {
			throw new Error("synthetic runtime refresh failure");
		}),
	} as never;

	await h.controller.handle("/mcp remove edge --scope project");
	expect((await readMCPConfigFile(path)).mcpServers?.edge).toBeUndefined();
	expect(h.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("managed credential cleanup failed"));
	expect(h.ctx.showWarning).toHaveBeenCalledWith(expect.stringContaining("runtime refresh failed"));
});

test("MCP list and help use bounded reports that distinguish saved and runtime state", async () => {
	const path = getMCPConfigPath("project", getProjectDir());
	await addMCPServer(path, "edge", { type: "stdio", command: "synthetic-server" });
	const h = harness([["\x1b"], ["\x1b"]]);
	await h.controller.handle("/mcp list");
	await h.controller.handle("/mcp help");
	expect(h.screens[0]).toContain("Configured MCP servers");
	expect(h.screens[0]).toContain("Saved configuration, discovery source, enabled state, and runtime");
	expect(h.screens[0]).toContain("edge");
	expect(h.screens[1]).toContain("Commands and connection-state boundaries");
	expect(h.screens[1]).toContain("Esc: close");
});
