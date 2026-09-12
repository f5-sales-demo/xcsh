import { afterEach, beforeAll, expect, test, vi } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";
import type { SessionForkPreview } from "../../../src/session/session-manager";
import { SessionManager } from "../../../src/session/session-manager";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
const directories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function harness(options: { failTailOnce?: boolean } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-fork-uat-"));
	directories.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: "Synthetic source conversation", timestamp: 1 });
	manager.appendMessage({ role: "user", content: "Synthetic follow-up", timestamp: 2 });
	await manager.ensureOnDisk();
	await manager.flush();
	const sourceId = manager.getSessionId();
	const sourceFile = manager.getSessionFile()!;
	const sourceBytes = await readFile(sourceFile, "utf8");
	const sourceArtifacts = sourceFile.slice(0, -6);
	await mkdir(sourceArtifacts);
	await writeFile(join(sourceArtifacts, "proof.txt"), "artifact proof");

	let component: Component;
	let failed = false;
	let forkCalls = 0;
	let completionCalls = 0;
	const complete = async (preview: SessionForkPreview) => {
		completionCalls++;
		await manager.retryPersistence();
		await cp(preview.sourceArtifactDir, preview.targetArtifactDir, { recursive: true });
	};
	const session = {
		isStreaming: false,
		async fork(preview: SessionForkPreview) {
			forkCalls++;
			await manager.flush();
			await manager.fork(preview);
			if (options.failTailOnce && !failed) {
				failed = true;
				throw new Error("Fixture artifact failure");
			}
			await complete(preview);
			return true;
		},
		completeReviewedFork: complete,
	};
	const container = { clear() {}, addChild() {} };
	const ctx = {
		sessionManager: manager,
		session,
		chatContainer: container,
		statusContainer: container,
		statusLine: { invalidate() {} },
		ui: { terminal: { rows: 24 }, requestRender() {} },
		updateEditorTopBorder() {},
		showStatus: vi.fn(),
		showError: vi.fn(),
		showWarning: vi.fn(),
		showHookCustom: (
			factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
		) =>
			new Promise(resolve => {
				component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
			}),
	} as unknown as InteractiveModeContext;
	return {
		controller: new CommandController(ctx),
		ctx,
		manager,
		sourceId,
		sourceFile,
		sourceBytes,
		ready: () => component !== undefined,
		input: (data: string) => component.handleInput?.(data),
		text: () => Bun.stripANSI(component.render(80).join("\n")),
		forkCalls: () => forkCalls,
		completionCalls: () => completionCalls,
	};
}

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 300; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Expected fork dialog state did not appear.");
}

test("cancelled fork review leaves source identity, file, and artifacts unchanged", async () => {
	const h = await harness();
	const pending = h.controller.handleForkCommand();
	await waitFor(h.ready);
	expect(h.text()).toContain("Review session fork");
	expect(h.text()).toContain("Cancel");
	h.input("\n");
	await pending;
	expect(h.forkCalls()).toBe(0);
	expect(h.manager.getSessionId()).toBe(h.sourceId);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
	expect(await readFile(join(h.sourceFile.slice(0, -6), "proof.txt"), "utf8")).toBe("artifact proof");
});

test("confirmed fork is reopenable, parent-linked, and copies artifacts without changing the source", async () => {
	const h = await harness();
	const pending = h.controller.handleForkCommand();
	await waitFor(h.ready);
	h.input("\x1b[B");
	h.input("\n");
	await pending;
	expect(h.forkCalls()).toBe(1);
	expect(h.manager.getSessionId()).not.toBe(h.sourceId);
	expect(h.manager.getSessionFile()).not.toBe(h.sourceFile);
	expect(await readFile(h.sourceFile, "utf8")).toBe(h.sourceBytes);
	expect(await readFile(join(h.manager.getSessionFile()!.slice(0, -6), "proof.txt"), "utf8")).toBe("artifact proof");
	const reopened = await SessionManager.open(h.manager.getSessionFile()!);
	expect(reopened.getSessionId()).toBe(h.manager.getSessionId());
	expect(reopened.getHeader()?.parentSession).toBe(h.sourceId);
	expect(h.ctx.showError).not.toHaveBeenCalled();
});

test("a changed source requires a renewed review before fork execution", async () => {
	const h = await harness();
	const pending = h.controller.handleForkCommand();
	await waitFor(h.ready);
	h.manager.appendMessage({ role: "user", content: "Concurrent change", timestamp: 3 });
	h.input("\x1b[B");
	h.input("\n");
	await Bun.sleep(20);
	expect(h.text()).toContain("proposal changed");
	expect(h.forkCalls()).toBe(0);
	expect(h.text()).toContain("Cancel");
	h.input("\n");
	await pending;
	expect(h.manager.getSessionId()).toBe(h.sourceId);
});

test("fork refuses a reviewed destination that appears before execution", async () => {
	const h = await harness();
	const preview = h.manager.previewFork()!;
	await writeFile(preview.targetSessionFile, "collision");
	await expect(h.manager.fork(preview)).rejects.toThrow("no overwrite");
	expect(h.manager.getSessionId()).toBe(h.sourceId);
	expect(await readFile(preview.targetSessionFile, "utf8")).toBe("collision");
});

test("partial fork failure retries only the already-created identity", async () => {
	const h = await harness({ failTailOnce: true });
	const pending = h.controller.handleForkCommand();
	await waitFor(h.ready);
	h.input("\x1b[B");
	h.input("\n");
	await waitFor(() => h.text().includes("Fixture artifact failure"));
	const createdId = h.manager.getSessionId();
	expect(createdId).not.toBe(h.sourceId);

	// First retry revalidates into the recovery proposal; renewed review starts on Cancel.
	h.input("\x1b[B");
	h.input("\n");
	await Bun.sleep(20);
	expect(h.text()).toContain("proposal changed");
	h.input("\x1b[B");
	h.input("\n");
	await pending;

	expect(h.forkCalls()).toBe(1);
	expect(h.completionCalls()).toBe(1);
	expect(h.manager.getSessionId()).toBe(createdId);
	expect(await readFile(join(h.manager.getSessionFile()!.slice(0, -6), "proof.txt"), "utf8")).toBe("artifact proof");
});
