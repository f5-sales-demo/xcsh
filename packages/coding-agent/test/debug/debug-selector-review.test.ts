import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { getAgentDir, getSessionsDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { DebugSelectorComponent, ProfilerControlComponent } from "../../src/debug";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));

const originalAgentDir = getAgentDir();
const roots: string[] = [];

afterEach(async () => {
	setAgentDir(originalAgentDir);
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function harness(
	reviewInputs: string[] = [],
	options: {
		sessionFile?: string;
		openLocalPath?: (target: string) => Promise<{ ok: true } | { ok: false; error: string }>;
	} = {},
) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-debug-review-"));
	roots.push(root);
	setAgentDir(path.join(root, "agent"));
	let review: Component | undefined;
	const screens: string[] = [];
	const session = {
		model: undefined,
		thinkingLevel: "medium",
		getContextProfile: () => ({
			loadingMode: "full",
			systemPromptBytes: 10,
			estimatedSystemPromptTokens: 3,
			initialToolBytes: 2,
			deferredToolBytes: 0,
			providerCalls: [],
		}),
	};
	const manager = { getSessionId: () => "fixture-session", getSessionFile: () => options.sessionFile };
	const showStatus = vi.fn();
	const ctx = {
		ui: { terminal: { rows: 24 }, requestRender() {}, setFocus() {}, showOverlay: vi.fn() },
		session,
		sessionManager: manager,
		planModeEnabled: false,
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		chatContainer: { addChild() {} },
		statusContainer: { addChild() {}, clear() {} },
		showStatus,
		showWarning: vi.fn(),
		showError: vi.fn(),
		showHookCustom: (factory: any) =>
			new Promise(resolve => {
				const component: Component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
				review = component;
				screens.push(Bun.stripANSI(component.render(80).join("\n")));
				for (const input of reviewInputs) component.handleInput?.(input);
			}),
	} as unknown as InteractiveModeContext;
	const selector = new DebugSelectorComponent(ctx, () => {}, { openLocalPath: options.openLocalPath });
	return {
		root,
		ctx,
		showStatus,
		selector,
		screens,
		reviewInput: (input: string) => review?.handleInput?.(input),
		reviewText: () => Bun.stripANSI(review?.render(80).join("\n") ?? ""),
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await Bun.sleep(2);
	}
	throw new Error("Expected debug action state was not reached");
}

/** Long file identities may wrap inside a fixed-width review frame. */
function terminalValue(value: string): string {
	return value.replace(/[│╭╮╰╯├┤─]/gu, "").replace(/\s+/gu, "");
}

function expectTerminalValue(text: string, value: string): void {
	expect(terminalValue(text)).toContain(terminalValue(value));
}

function searchAndSelect(component: Component, query: string): void {
	for (const char of query) component.handleInput?.(char);
	component.handleInput?.("\r");
}

test("debug inventory uses the shared searchable bounded selector", async () => {
	const h = await harness();
	const initial = Bun.stripANSI(h.selector.render(140).join("\n"));
	expect(initial.split("\n")[0].length).toBe(100);
	expect(initial).toContain("Debug tools and privacy-safe diagnostics");
	searchAndSelect(h.selector, "no-match");
	const empty = Bun.stripANSI(h.selector.render(60).join("\n"));
	expect(empty).toContain("No matching options.");
	h.selector.handleInput?.("\x1b");
	expect(Bun.stripANSI(h.selector.render(60).join("\n"))).toContain("10 of 10 options");
});

test("CPU profiler separates Escape navigation from Ctrl+C execution control", () => {
	const done = vi.fn();
	const control = new ProfilerControlComponent(done, () => 20);
	const rendered = Bun.stripANSI(control.render(80).join("\n"));
	expect(rendered).toContain("Escape does not stop profiling");
	expect(rendered).toContain("Ctrl+C: stop without saving");
	control.handleInput("\x1b");
	expect(done).not.toHaveBeenCalled();
	control.handleInput("\x03");
	expect(done).toHaveBeenCalledWith("interrupted");
});

test.each([false, true])("artifact cache deletion is exact and Cancel-first (confirm: %s)", async confirm => {
	const h = await harness();
	const sessionsDir = getSessionsDir();
	const artifact = path.join(sessionsDir, "old-artifact");
	await fs.mkdir(artifact, { recursive: true });
	await fs.writeFile(path.join(artifact, "output.txt"), "synthetic artifact");
	const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
	await fs.utimes(artifact, old, old);
	searchAndSelect(h.selector, "artifact cache");
	await waitFor(() => h.reviewText().includes("Review artifact cache removal"));
	expectTerminalValue(h.reviewText(), artifact);
	expect(h.reviewText()).toContain("Session");
	expect(h.reviewText()).toContain("transcript files are not selected");
	expect(await Bun.file(path.join(artifact, "output.txt")).exists()).toBe(true);
	if (confirm) h.reviewInput("\x1b[B");
	h.reviewInput("\r");
	await waitFor(() =>
		confirm ? !require("node:fs").existsSync(artifact) && h.showStatus.mock.calls.length === 1 : true,
	);
	expect(require("node:fs").existsSync(artifact)).toBe(!confirm);
	if (confirm)
		expect(h.ctx.showStatus).toHaveBeenCalledWith(expect.stringContaining("Cleared 1 artifact directories"));
});

test("debug report creation opens a reviewed exact destination before writing", async () => {
	const h = await harness(["\r"]);
	searchAndSelect(h.selector, "dump session");
	await waitFor(() => h.screens.length > 0);
	expect(h.screens[0]).toContain("Review bundle debug report");
	expect(h.screens[0]).toContain("Local diagnostic report");
	expect(h.screens[0]).toContain("Absent →");
	expect(h.screens[0]).toContain("Compressed diagnostic archive");
	expect(h.screens[0]).toContain("No upload or remote publication");
	expect(h.screens[0]).toContain("occurs");
});

test.each([false, true])(
	"artifact folder launch is identity-qualified and Cancel-first (confirm: %s)",
	async confirm => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-debug-artifacts-"));
		roots.push(root);
		const sessionFile = path.join(root, "session.jsonl");
		const artifactDir = path.join(root, "session");
		await fs.writeFile(sessionFile, "{}\n");
		await fs.mkdir(artifactDir);
		const openLocalPath = vi.fn(async () => ({ ok: true as const }));
		const h = await harness([], { sessionFile, openLocalPath });
		searchAndSelect(h.selector, "Open: artifact folder");
		await waitFor(() => h.reviewText().includes("Review artifact folder"));
		expectTerminalValue(h.reviewText(), artifactDir);
		expect(h.reviewText()).toContain("Directory · device");
		expect(h.reviewText()).toContain("recent-item history");
		expect(openLocalPath).not.toHaveBeenCalled();
		if (confirm) h.reviewInput("\x1b[B");
		h.reviewInput("\r");
		await waitFor(() => (confirm ? openLocalPath.mock.calls.length === 1 : true));
		expect(openLocalPath).toHaveBeenCalledTimes(confirm ? 1 : 0);
		if (confirm) expect(h.ctx.showStatus).toHaveBeenCalledWith(`Opened: ${artifactDir}`);
	},
);

test("artifact folder replacement requires renewed review and does not launch stale identity", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-debug-artifacts-stale-"));
	roots.push(root);
	const sessionFile = path.join(root, "session.jsonl");
	const artifactDir = path.join(root, "session");
	await fs.writeFile(sessionFile, "{}\n");
	await fs.mkdir(artifactDir);
	const openLocalPath = vi.fn(async () => ({ ok: true as const }));
	const h = await harness([], { sessionFile, openLocalPath });
	searchAndSelect(h.selector, "Open: artifact folder");
	await waitFor(() => h.reviewText().includes("Review artifact folder"));
	const originalDir = path.join(root, "original-session-artifacts");
	const replacementDir = path.join(root, "replacement-session-artifacts");
	await fs.mkdir(replacementDir);
	await fs.rename(artifactDir, originalDir);
	await fs.rename(replacementDir, artifactDir);
	h.reviewInput("\x1b[B");
	h.reviewInput("\r");
	await waitFor(() => h.reviewText().includes("proposal changed"));
	expect(openLocalPath).not.toHaveBeenCalled();
	h.reviewInput("\r");
});
