import { beforeAll, expect, test, vi } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Component, getKeybindings, parseSgrMouse, setKeybindings, visibleWidth } from "@f5-sales-demo/pi-tui";
import { getAgentDbPath } from "@f5-sales-demo/pi-utils";
import { KeybindingsManager } from "../../../src/config/keybindings";
import {
	clearReviewedMemoryData,
	enqueueReviewedMemoryConsolidation,
	getMemoryRoot,
	inspectMemoryClear,
	inspectMemoryConsolidation,
} from "../../../src/memories";
import { closeMemoryDb, openMemoryDb, upsertThreads } from "../../../src/memories/storage";
import { ReportDetailsComponent } from "../../../src/modes/components/selector-frame";
import { CommandController } from "../../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../../src/modes/types";

beforeAll(async () => setThemeInstance((await getThemeByName("xcsh-dark"))!));
test("report paging honors remaps and displays the configured control", () => {
	const previous = getKeybindings();
	try {
		const keys = KeybindingsManager.inMemory();
		keys.setUserBindings({ "tui.select.pageDown": "alt+j" });
		setKeybindings(keys);
		const view = new ReportDetailsComponent(
			"Report",
			"Scope",
			Array.from({ length: 50 }, (_, index) => `Detail ${index + 1}`).join("\n"),
			() => {},
			() => 20,
		);
		const initial = Bun.stripANSI(view.render(80).join("\n"));
		expect(initial).toContain("Alt+J");
		view.handleInput("\x1b[6~");
		expect(Bun.stripANSI(view.render(80).join("\n"))).toBe(initial);
		view.handleInput("\x1bj");
		expect(Bun.stripANSI(view.render(80).join("\n"))).toContain("Detail 11");
	} finally {
		setKeybindings(previous);
	}
});
test("report wheel navigation and resizing retain the logical source line", () => {
	const view = new ReportDetailsComponent(
		"Report",
		"Scope",
		Array.from({ length: 30 }, (_, index) => `Detail ${index + 1}: ${"word ".repeat(14)}`).join("\n"),
		() => {},
		() => 20,
	);
	view.render(60);
	view.handleInput("\x1b[6~");
	const before = Bun.stripANSI(view.render(60).join("\n")).match(/Detail (\d+)/)?.[1];
	const after = Bun.stripANSI(view.render(100).join("\n")).match(/Detail (\d+)/)?.[1];
	expect(after).toBe(before);
	view.routeMouse(parseSgrMouse("\x1b[<65;4;8M")!, 7, 3);
	const scrolled = Bun.stripANSI(view.render(100).join("\n")).match(/Detail (\d+)/)?.[1];
	expect(Number(scrolled)).toBe(Number(after) + 1);
});
test("read-only report reaches the final detail at every required size; Ctrl+C is not Back", () => {
	for (const [columns, rows] of [
		[60, 20],
		[80, 24],
		[100, 32],
		[140, 40],
	]) {
		const close = vi.fn();
		const view = new ReportDetailsComponent(
			"Report",
			"Synthetic scope",
			Array.from({ length: 100 }, (_, index) => `Detail ${index + 1}`).join("\n"),
			close,
			() => rows,
		);
		expect(Bun.stripANSI(view.render(columns).join("\n"))).toContain(": details");
		for (let i = 0; i < 100; i++) view.handleInput("\x1b[6~");
		const lines = view.render(columns);
		expect(Bun.stripANSI(lines.join("\n"))).toContain("Detail 100");
		expect(lines.length).toBeLessThanOrEqual(rows);
		expect(lines.every(line => visibleWidth(line) <= Math.min(100, columns))).toBe(true);
		view.handleInput("\x03");
		expect(close).not.toHaveBeenCalled();
		view.handleInput("\x1b");
		view.handleInput("\x1b");
		expect(close).toHaveBeenCalledTimes(1);
	}
});

test("memory view distinguishes disabled saved content, missing summary and unavailable data", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-view-"));
	try {
		const cwd = "/synthetic/project";
		const file = join(getMemoryRoot(root, cwd), "memory_summary.md");
		const screens: string[] = [];
		const ctx = {
			settings: { getAgentDir: () => root, get: () => false },
			sessionManager: { getCwd: () => cwd },
			showError: vi.fn(),
			showHookCustom: (factory: (ui: unknown, theme: unknown, keys: unknown, done: () => void) => Component) =>
				new Promise<void>(resolve => {
					const view = factory({ terminal: { rows: 40 }, requestRender() {} }, {}, {}, resolve);
					screens.push(Bun.stripANSI(view.render(100).join("\n")));
					view.handleInput?.("\x1b");
				}),
		} as unknown as InteractiveModeContext;
		const controller = new CommandController(ctx);
		await controller.handleMemoryCommand("/memory");
		expect(screens[0]).toContain("No saved memory summary exists");
		await mkdir(getMemoryRoot(root, cwd), { recursive: true });
		await Bun.write(file, "Synthetic saved summary");
		await controller.handleMemoryCommand("/memory view");
		expect(screens[1]).toContain("Memory disabled");
		expect(screens[1]).toContain("Synthetic saved summary");
		await rm(file);
		await mkdir(file);
		await controller.handleMemoryCommand("/memory view");
		expect(ctx.showError).toHaveBeenCalledWith(
			"Memory summary is unavailable. Check file access and retry; no data was changed.",
		);
		expect(screens).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("memory clear/reset review discloses global records and leaves data intact on Cancel", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-review-"));
	try {
		const cwd = join(root, "project");
		const memoryRoot = getMemoryRoot(root, cwd);
		await mkdir(memoryRoot, { recursive: true });
		await Bun.write(join(memoryRoot, "fixture.txt"), "synthetic memory");
		const db = openMemoryDb(getAgentDbPath(root));
		upsertThreads(db, [
			{
				id: "other-project",
				updatedAt: 1,
				rolloutPath: "synthetic",
				cwd: "/synthetic/other",
				sourceKind: "fixture",
			},
		]);
		closeMemoryDb(db);
		const before = await inspectMemoryClear(root, cwd);
		let confirm = false;
		const screens: string[] = [];
		const ctx = {
			settings: { getAgentDir: () => root },
			sessionManager: { getCwd: () => cwd },
			session: { refreshBaseSystemPrompt: vi.fn(async () => {}) },
			showStatus: vi.fn(),
			showError: vi.fn(),
			showHookCustom: (
				factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
			) =>
				new Promise(resolve => {
					const component = factory({ terminal: { rows: 32 }, requestRender() {} }, {}, {}, resolve);
					screens.push(Bun.stripANSI(component.render(100).join("\n")));
					if (confirm) component.handleInput?.("\x1b[B");
					component.handleInput?.("\r");
				}),
		} as unknown as InteractiveModeContext;
		const controller = new CommandController(ctx);
		for (const command of ["/memory clear", "/memory reset"]) {
			await controller.handleMemoryCommand(command);
			expect((await inspectMemoryClear(root, cwd)).revision).toBe(before.revision);
		}
		expect(screens[0]).toContain("All-project database records");
		expect(screens[0]).toContain("1 threads");
		expect(ctx.session.refreshBaseSystemPrompt).not.toHaveBeenCalled();
		confirm = true;
		await controller.handleMemoryCommand("/memory clear");
		expect(ctx.showError).not.toHaveBeenCalled();
		const after = await inspectMemoryClear(root, cwd);
		expect(after.threads).toBe(0);
		expect(after.files).toBe(0);
		expect(await Bun.file(join(memoryRoot, "fixture.txt")).exists()).toBe(false);
		expect(ctx.session.refreshBaseSystemPrompt).toHaveBeenCalledTimes(1);
		expect(ctx.showStatus).toHaveBeenCalledTimes(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("memory clear inspection of an absent store creates no database", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-empty-"));
	try {
		const snapshot = await inspectMemoryClear(root, "/synthetic/project");
		expect(snapshot.threads).toBe(0);
		expect(snapshot.files).toBe(0);
		expect(await Bun.file(snapshot.database).exists()).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("reviewed memory deletion rejects new records and running jobs without deleting artifacts", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-stale-"));
	try {
		const cwd = "/synthetic/project";
		const artifact = join(getMemoryRoot(root, cwd), "fixture.txt");
		await mkdir(getMemoryRoot(root, cwd), { recursive: true });
		await Bun.write(artifact, "unchanged artifact");
		const db = openMemoryDb(getAgentDbPath(root));
		const reviewed = await inspectMemoryClear(root, cwd);
		upsertThreads(db, [{ id: "new", updatedAt: 1, rolloutPath: "synthetic", cwd, sourceKind: "fixture" }]);
		await expect(clearReviewedMemoryData(root, cwd, reviewed)).rejects.toThrow("changed");
		expect(await Bun.file(artifact).text()).toBe("unchanged artifact");
		expect((await inspectMemoryClear(root, cwd)).threads).toBe(1);
		db.exec("INSERT INTO jobs(kind,job_key,status,retry_remaining) VALUES ('memory_stage1','new','running',3)");
		const running = await inspectMemoryClear(root, cwd);
		await expect(clearReviewedMemoryData(root, cwd, running)).rejects.toThrow("running");
		expect((await inspectMemoryClear(root, cwd)).threads).toBe(1);
		closeMemoryDb(db);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("a database deletion failure rolls back earlier memory-table deletions and preserves files", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-rollback-"));
	let db: ReturnType<typeof openMemoryDb> | undefined;
	try {
		const cwd = "/synthetic/project";
		const artifact = join(getMemoryRoot(root, cwd), "fixture.txt");
		await mkdir(getMemoryRoot(root, cwd), { recursive: true });
		await Bun.write(artifact, "preserved");
		db = openMemoryDb(getAgentDbPath(root));
		upsertThreads(db, [{ id: "fixture", updatedAt: 1, rolloutPath: "synthetic", cwd, sourceKind: "fixture" }]);
		db.exec(
			"INSERT INTO stage1_outputs(thread_id,source_updated_at,raw_memory,rollout_summary,generated_at) VALUES ('fixture',1,'synthetic','synthetic',1)",
		);
		db.exec(
			"CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON threads BEGIN SELECT RAISE(ABORT, 'fixture deletion blocked'); END",
		);
		const before = await inspectMemoryClear(root, cwd);
		await expect(clearReviewedMemoryData(root, cwd, before)).rejects.toThrow("fixture deletion blocked");
		const after = await inspectMemoryClear(root, cwd);
		expect(after.revision).toBe(before.revision);
		expect(after.outputs).toBe(1);
		expect(await Bun.file(artifact).text()).toBe("preserved");
	} finally {
		if (db) closeMemoryDb(db);
		await rm(root, { recursive: true, force: true });
	}
});
test("enqueue/rebuild cancellation creates no database; confirmed request persists only the target project", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-memory-queue-"));
	try {
		const cwd = "/synthetic/project";
		let confirm = false;
		const ctx = {
			settings: { getAgentDir: () => root },
			sessionManager: { getCwd: () => cwd },
			showStatus: vi.fn(),
			showError: vi.fn(),
			showHookCustom: (
				factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
			) =>
				new Promise(resolve => {
					const view = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
					expect(Bun.stripANSI(view.render(100).join("\n"))).toContain("Review memory consolidation");
					if (confirm) view.handleInput?.("\x1b[B");
					view.handleInput?.("\r");
				}),
		} as unknown as InteractiveModeContext;
		const controller = new CommandController(ctx);
		await controller.handleMemoryCommand("/memory enqueue");
		await controller.handleMemoryCommand("/memory rebuild");
		expect(await Bun.file(getAgentDbPath(root)).exists()).toBe(false);
		confirm = true;
		await controller.handleMemoryCommand("/memory rebuild");
		expect(ctx.showError).not.toHaveBeenCalled();
		expect(inspectMemoryConsolidation(root, cwd).state).toContain("pending");
		expect(inspectMemoryConsolidation(root, "/synthetic/other").state).toBe("No consolidation request");
		expect(ctx.showStatus).toHaveBeenCalledWith(
			"Memory consolidation request saved for this project. Consolidation has not been verified as started or completed.",
		);
		const old = inspectMemoryConsolidation(root, "/synthetic/other");
		enqueueReviewedMemoryConsolidation(root, "/synthetic/other", old);
		const current = inspectMemoryConsolidation(root, "/synthetic/other");
		expect(() => enqueueReviewedMemoryConsolidation(root, "/synthetic/other", old)).toThrow("queue changed");
		expect(inspectMemoryConsolidation(root, "/synthetic/other").revision).toBe(current.revision);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
