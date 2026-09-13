import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { getAgentDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { createMediaId } from "../../../src/media/types";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { setTheme } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import { SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => {
	await setTheme("xcsh-dark");
});
const managers: SessionManager[] = [];
const roots: string[] = [];
const originalAgentDir = getAgentDir();
afterEach(async () => {
	vi.restoreAllMocks();
	setAgentDir(originalAgentDir);
	for (const manager of managers.splice(0)) await manager.close();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function harness() {
	const root = await mkdtemp(join(tmpdir(), "xcsh-export-review-"));
	roots.push(root);
	const manager = SessionManager.create(root, root);
	managers.push(manager);
	manager.appendMessage({ role: "user", content: "Synthetic export conversation", timestamp: 1 });
	await manager.retryPersistence();
	let component: Component | undefined;
	let error: string | undefined;
	const ctx = {
		sessionManager: manager,
		session: { state: undefined },
		chatContainer: { addChild() {}, render: () => ["Synthetic rendered transcript"] },
		editor: {},
		editorContainer: { clear() {}, addChild() {} },
		ui: { terminal: { rows: 32, columns: 100 }, setFocus: vi.fn(), requestRender() {} },
		showStatus: vi.fn(),
		showWarning: vi.fn(),
		showError: vi.fn((message: string) => {
			error = message;
		}),
		showHookCustom: (factory: any) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 32 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	const controller = new CommandController(ctx);
	const open = vi.spyOn(controller, "openLocalPath").mockResolvedValue({ ok: true });
	return {
		root,
		manager,
		ctx,
		controller,
		open,
		text: () => {
			if (error) throw new Error(error);
			return component ? Bun.stripANSI(component.render(100).join("\n")) : "";
		},
		input: (key: string) => component?.handleInput?.(key),
	};
}
async function waitFor(predicate: () => boolean | Promise<boolean>) {
	for (let index = 0; index < 200; index++) {
		if (await predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Export review state not reached");
}

/** Review frames wrap paths without changing the reviewed file identity. */
function terminalValue(value: string): string {
	return value.replace(/[│╭╮╰╯├┤─]/gu, "").replace(/\s+/gu, "");
}

function expectTerminalValue(text: string, value: string): void {
	expect(terminalValue(text)).toContain(terminalValue(value));
}

test.each([false, true])(
	"HTML export reviews its complete quoted destination before writing (confirm: %s)",
	async confirm => {
		const h = await harness();
		const destination = join(h.root, "export with spaces.html");
		const pending = h.controller.handleExportCommand(`/export "${destination}"`);
		await waitFor(() => h.text().includes("Review session export"));
		expectTerminalValue(h.text(), destination);
		expect(h.text()).toContain("Absent");
		expect(h.text()).toContain("0600");
		expect(await Bun.file(destination).exists()).toBe(false);
		if (confirm) h.input("\x1b[B");
		h.input("\r");
		await pending;
		expect(await Bun.file(destination).exists()).toBe(confirm);
		expect(h.open).toHaveBeenCalledTimes(confirm ? 1 : 0);
		expect(h.ctx.showStatus).toHaveBeenCalledTimes(confirm ? 1 : 0);
		if (confirm) {
			expect(await readFile(destination, "utf8")).toContain('id="session-data"');
			expect((await fs.stat(destination)).mode & 0o777).toBe(0o600);
		}
	},
);

test("identical export review accurately discloses no file writes", async () => {
	const h = await harness();
	const destination = join(h.root, "unchanged.html");
	const initial = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("Review session export"));
	h.input("\x1b[B");
	h.input("\r");
	await initial;
	const before = await fs.stat(destination);
	const repeated = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("unchanged; no write"));
	expect(h.text()).toContain("All export files already match; no files or directories will be written.");
	expect(h.text()).not.toContain("Existing files are replaced.");
	h.input("\x1b[B");
	h.input("\r");
	await repeated;
	const after = await fs.stat(destination);
	expect(after.ino).toBe(before.ino);
	expect(after.mtimeMs).toBe(before.mtimeMs);
});

test("changed export destination requires renewed Cancel-first review", async () => {
	const h = await harness();
	const destination = join(h.root, "existing.html");
	await writeFile(destination, "Original export");
	const pending = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("Review session export"));
	await writeFile(destination, "Concurrent replacement");
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expect(await readFile(destination, "utf8")).toBe("Concurrent replacement");
	h.input("\r");
	await pending;
	expect(await readFile(destination, "utf8")).toBe("Concurrent replacement");
	expect(h.open).not.toHaveBeenCalled();
});

test("duplicate export commands cannot start a second review or file write", async () => {
	const h = await harness();
	const first = join(h.root, "first.html");
	const second = join(h.root, "second.html");
	const pending = h.controller.handleExportCommand(`/export ${first}`);
	await h.controller.handleExportCommand(`/export ${second}`);
	await waitFor(() => h.text().includes("Review session export"));
	expectTerminalValue(h.text(), first);
	expect(h.ctx.showWarning).toHaveBeenCalled();
	h.input("\r");
	await pending;
	expect(await Bun.file(first).exists()).toBe(false);
	expect(await Bun.file(second).exists()).toBe(false);
});

test("partial media export retries only unresolved files after renewed review", async () => {
	const h = await harness();
	const blob = await h.manager.putBlob(Buffer.from("Synthetic video"));
	h.manager.appendMessage({
		role: "media",
		timestamp: 2,
		media: {
			version: 1,
			id: createMediaId(blob.hash),
			kind: "video",
			original: { ref: blob.ref, mimeType: "video/mp4", bytes: 15 },
			provenance: { sourceType: "tool", source: "fixture" },
			playback: { autoplay: false, loop: false, muted: true, fpsCap: 12 },
		},
	});
	const destination = join(h.root, "media.html");
	const canonicalDestination = join(await fs.realpath(h.root), "media.html");
	const sidecar = join(h.root, "media-media", `${blob.hash}.mp4`);
	const canonicalSidecar = join(await fs.realpath(h.root), "media-media", `${blob.hash}.mp4`);
	const rename = fs.rename;
	let failed = false;
	const writes = vi.spyOn(fs, "rename").mockImplementation(async (source, target) => {
		if (target === canonicalDestination && !failed) {
			failed = true;
			throw new Error("Synthetic HTML rename failure");
		}
		await rename(source, target);
	});
	const pending = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("Review session export"));
	expectTerminalValue(h.text(), "media-media/");
	expect(h.text()).toContain(`${blob.hash.slice(-12)}.mp4`);
	expect(await Bun.file(sidecar).exists()).toBe(false);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(
		async () =>
			(await Bun.file(sidecar).exists()) &&
			!(await Bun.file(destination).exists()) &&
			!(await fs.readdir(h.root)).some(name => name.startsWith(".xcsh-export-")),
	);
	expect(await readFile(sidecar, "utf8")).toBe("Synthetic video");
	expect(await Bun.file(destination).exists()).toBe(false);
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
	expect((await fs.readdir(h.root)).filter(name => name.startsWith(".xcsh-export-"))).toEqual([]);
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("proposal changed"));
	expectTerminalValue(h.text(), "unchanged; no write");
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	expect(await Bun.file(destination).exists()).toBe(true);
	expect(writes.mock.calls.filter(call => call[1] === canonicalSidecar)).toHaveLength(1);
	expect(h.ctx.showStatus).toHaveBeenCalledTimes(1);
});

test("session changes invalidate export before writing", async () => {
	const h = await harness();
	const destination = join(h.root, "stale.html");
	const pending = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("Review session export"));
	await h.manager.newSession();
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("target changed"));
	h.input("\r");
	await pending;
	expect(await Bun.file(destination).exists()).toBe(false);
	expect(h.open).not.toHaveBeenCalled();
});

test("failed temporary export write preserves the destination and removes its owned partial file", async () => {
	const h = await harness();
	const destination = join(h.root, "safe.html");
	await writeFile(destination, "Previous contents");
	const write = fs.writeFile;
	vi.spyOn(fs, "writeFile").mockImplementation(async (file, bytes, options) => {
		await write(file, bytes, options);
		throw new Error("Synthetic write failure after bytes reached disk");
	});
	const pending = h.controller.handleExportCommand(`/export ${destination}`);
	await waitFor(() => h.text().includes("Review session export"));
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("writes unresolved"));
	h.input("\r");
	await pending;
	expect(await readFile(destination, "utf8")).toBe("Previous contents");
	expect((await fs.readdir(h.root)).filter(name => name.startsWith(".xcsh-export-"))).toEqual([]);
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
});

test.each([false, true])(
	"session sharing is Cancel-first before staging or custom publication (confirm: %s)",
	async confirm => {
		const h = await harness();
		const agentDir = join(h.root, "agent");
		const marker = join(h.root, "published.html");
		await fs.mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "share.mjs"),
			`export default async function (source) { await Bun.write(${JSON.stringify(marker)}, Bun.file(source)); return { url: "https://share.invalid/result", message: "fixture published" }; }`,
		);
		setAgentDir(agentDir);
		const pending = h.controller.handleShareCommand();
		await waitFor(() => h.text().includes("Review session publication"));
		expectTerminalValue(h.text(), `custom handler ${join(agentDir, "share.mjs")}`);
		expect(h.text()).toContain("Visibility");
		expect(h.text()).toContain("may publish sensitive conversation");
		expect(h.text()).toContain("content remotely");
		expect(await Bun.file(marker).exists()).toBe(false);
		if (confirm) h.input("\x1b[B");
		h.input("\r");
		await pending;
		expect(await Bun.file(marker).exists()).toBe(confirm);
		if (confirm) {
			expect(await readFile(marker, "utf8")).toContain('id="session-data"');
			expect(h.ctx.showStatus).toHaveBeenCalledWith("Share URL: https://share.invalid/result\nfixture published");
			expect(h.open).not.toHaveBeenCalled();
		} else {
			expect(h.ctx.showStatus).not.toHaveBeenCalled();
			expect(h.open).not.toHaveBeenCalled();
		}
	},
);

test("failed custom publication removes staging and retries without false success", async () => {
	const h = await harness();
	const agentDir = join(h.root, "agent-retry");
	const attempts = join(h.root, "publication-attempts.nul");
	await fs.mkdir(agentDir, { recursive: true });
	await writeFile(
		join(agentDir, "share.mjs"),
		`import { appendFile } from "node:fs/promises";
let calls = 0;
export default async function (source) {
	await appendFile(${JSON.stringify(attempts)}, source + "\\0");
	calls++;
	if (calls === 1) throw new Error("Synthetic publisher failure");
	return { url: "https://share.invalid/retry", message: "retry completed" };
}
`,
	);
	setAgentDir(agentDir);
	const pending = h.controller.handleShareCommand();
	await waitFor(() => h.text().includes("Review session publication"));
	h.input("\x1b[B");
	h.input("\r");
	await waitFor(() => h.text().includes("Unresolved session publication"));
	expect(h.text()).toContain("Synthetic publisher failure");
	expect(h.ctx.showStatus).not.toHaveBeenCalled();
	expect(h.ctx.ui.setFocus).not.toHaveBeenCalled();
	const firstSource = (await readFile(attempts, "utf8")).split("\0").filter(Boolean)[0]!;
	expect(await Bun.file(dirname(firstSource)).exists()).toBe(false);
	h.input("\x1b[B");
	h.input("\r");
	await pending;
	const sources = (await readFile(attempts, "utf8")).split("\0").filter(Boolean);
	expect(sources).toHaveLength(2);
	expect(sources[1]).toBe(firstSource);
	expect(await Bun.file(dirname(firstSource)).exists()).toBe(false);
	expect(h.ctx.showStatus).toHaveBeenCalledWith("Share URL: https://share.invalid/retry\nretry completed");
	expect(h.open).not.toHaveBeenCalled();
});

test("duplicate share commands cannot open a second publication review", async () => {
	const h = await harness();
	const agentDir = join(h.root, "agent");
	await fs.mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "share.mjs"), "export default async function () {}\n");
	setAgentDir(agentDir);
	const first = h.controller.handleShareCommand();
	await waitFor(() => h.text().includes("Review session publication"));
	await h.controller.handleShareCommand();
	expect(h.ctx.showWarning).toHaveBeenCalledWith("A session share review or publication is already active.");
	h.input("\r");
	await first;
});

test.each([false, true])("TUI transcript file export is Cancel-first (confirm: %s)", async confirm => {
	const h = await harness();
	const pending = h.controller.handleDebugTranscriptCommand();
	await waitFor(() => h.text().includes("Review TUI transcript export"));
	const reviewText = h.text();
	expect(reviewText).toContain("Local diagnostic export");
	expect(reviewText).toContain("Absent");
	expect(reviewText).toContain("permissions 0600");
	const destination = terminalValue(reviewText).match(/\/(?:private\/)?(?:var|tmp)\/\S+?-tui-transcript\.txt/)?.[0];
	expect(destination).toBeDefined();
	if (confirm) h.input("\x1b[B");
	h.input("\r");
	await pending;
	if (!confirm) {
		expect(h.ctx.showStatus).not.toHaveBeenCalled();
		return;
	}
	expect(await readFile(destination!, "utf8")).toBe("Synthetic rendered transcript\n");
	expect((await fs.stat(destination!)).mode & 0o777).toBe(0o600);
	await fs.unlink(destination!);
});
