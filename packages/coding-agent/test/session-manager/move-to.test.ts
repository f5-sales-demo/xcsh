import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Component } from "@f5-sales-demo/pi-tui";
import {
	getConfigRootDir,
	getProjectDir,
	getShellPwd,
	setAgentDir,
	setProjectDir,
	setShellPwd,
} from "@f5-sales-demo/pi-utils";
import { CommandController } from "../../src/modes/controllers/command-controller";
import { getThemeByName, setThemeInstance } from "../../src/modes/theme/theme";
import type { InteractiveModeContext } from "../../src/modes/types";
import { loadEntriesFromFile, type SessionHeader, SessionManager } from "../../src/session/session-manager";
import { FileSessionStorage } from "../../src/session/session-storage";
import { stripOuterDoubleQuotes } from "../../src/tools/path-utils";

// -- helpers ----------------------------------------------------------------

function makeAssistantMessage() {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "ok" }],
		api: "anthropic-messages" as const,
		provider: "anthropic" as const,
		model: "claude-sonnet-4-20250514",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function getHeader(entries: unknown[]): SessionHeader | undefined {
	return entries.find(
		(e): e is SessionHeader => typeof e === "object" && e !== null && "type" in e && (e as any).type === "session",
	) as SessionHeader | undefined;
}

function hasAssistantEntry(entries: unknown[]): boolean {
	return entries.some(
		e =>
			typeof e === "object" &&
			e !== null &&
			"type" in e &&
			(e as any).type === "message" &&
			"message" in e &&
			(e as any).message?.role === "assistant",
	);
}

// -- stripOuterDoubleQuotes tests -------------------------------------------

describe("stripOuterDoubleQuotes", () => {
	it("strips matching double quotes", () => {
		expect(stripOuterDoubleQuotes('"C:\\Users\\example"')).toBe("C:\\Users\\example");
	});
	it("strips matching double quotes from POSIX paths", () => {
		expect(stripOuterDoubleQuotes('"/home/user/test"')).toBe("/home/user/test");
	});
	it("passes through unquoted paths", () => {
		expect(stripOuterDoubleQuotes("C:\\Users\\example")).toBe("C:\\Users\\example");
	});
	it("does not strip mismatched quotes", () => {
		expect(stripOuterDoubleQuotes('"mismatched')).toBe('"mismatched');
	});
	it("does not strip single quotes", () => {
		expect(stripOuterDoubleQuotes("'foo'")).toBe("'foo'");
	});
	it("does not strip a lone double quote", () => {
		expect(stripOuterDoubleQuotes('"')).toBe('"');
	});
	it("strips empty quoted string to empty", () => {
		expect(stripOuterDoubleQuotes('""')).toBe("");
	});
});

// -- moveTo() tests ---------------------------------------------------------

describe("SessionManager.moveTo", () => {
	let testAgentDir: string;
	let cwdA: string;
	let cwdB: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

	beforeEach(async () => {
		testAgentDir = await fsp.mkdtemp(path.join(os.tmpdir(), "xcsh-move-test-"));
		setAgentDir(testAgentDir);
		cwdA = path.join(testAgentDir, "cwd-a");
		cwdB = path.join(testAgentDir, "cwd-b");
		fs.mkdirSync(cwdA, { recursive: true });
		fs.mkdirSync(cwdB, { recursive: true });
	});

	afterEach(async () => {
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(fallbackAgentDir);
			delete process.env.PI_CODING_AGENT_DIR;
		}
		await fsp.rm(testAgentDir, { recursive: true, force: true });
	});

	it("moves session file and updates header cwd (baseline)", async () => {
		const session = SessionManager.create(cwdA);
		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage(makeAssistantMessage());
		await session.flush();

		const oldFile = session.getSessionFile()!;
		expect(fs.existsSync(oldFile)).toBe(true);

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		expect(fs.existsSync(oldFile)).toBe(false);

		const newFile = session.getSessionFile()!;
		expect(fs.existsSync(newFile)).toBe(true);

		// Reload and verify content
		const entries = await loadEntriesFromFile(newFile);
		const header = getHeader(entries);
		expect(header?.cwd).toBe(path.resolve(cwdB));
		expect(hasAssistantEntry(entries)).toBe(true);
	});
	it("review preview does not create its destination, and reviewed move preserves identity and artifacts", async () => {
		const session = SessionManager.create(cwdA);
		session.appendMessage({ role: "user", content: "synthetic", timestamp: 1 });
		await session.ensureOnDisk();
		await session.flush();
		const identity = session.getSessionId();
		const oldFile = session.getSessionFile()!;
		await fsp.mkdir(oldFile.slice(0, -6));
		await fsp.writeFile(path.join(oldFile.slice(0, -6), "fixture.txt"), "synthetic artifact");
		const preview = session.previewMoveTo(cwdB);
		expect(fs.existsSync(preview.sessionDir)).toBe(false);
		expect(session.getCwd()).toBe(cwdA);
		await session.moveToReviewed(cwdB, preview);
		await session.flush();
		expect(fs.existsSync(oldFile)).toBe(false);
		expect((await SessionManager.open(preview.sessionFile!)).getSessionId()).toBe(identity);
		expect(await fsp.readFile(path.join(preview.artifactDir!, "fixture.txt"), "utf8")).toBe("synthetic artifact");
	});
	it("interactive typed and argument-free cancellation perform no move or destination creation", async () => {
		setThemeInstance((await getThemeByName("xcsh-dark"))!);
		const manager = SessionManager.create(cwdA);
		await manager.ensureOnDisk();
		const before = await fsp.readFile(manager.getSessionFile()!, "utf8");
		const destination = manager.previewMoveTo(cwdB);
		const move = vi.spyOn(manager, "moveToReviewed");
		const screens: string[] = [];
		const ctx = {
			sessionManager: manager,
			session: { isStreaming: false },
			showStatus: vi.fn(),
			showError: vi.fn(),
			showHookCustom: (
				factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
			) =>
				new Promise(resolve => {
					const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
					screens.push(Bun.stripANSI(component.render(80).join("\n")));
					component.handleInput?.("\x1b");
				}),
		} as unknown as InteractiveModeContext;
		const controller = new CommandController(ctx);
		await controller.handleMoveCommand(cwdB);
		await controller.handleMoveCommand("");
		expect(screens[0]).toContain("Review session move");
		expect(screens[1]).toContain("Move session");
		expect(move).not.toHaveBeenCalled();
		expect(ctx.showError).not.toHaveBeenCalled();
		expect(fs.existsSync(destination.sessionDir)).toBe(false);
		expect(await fsp.readFile(manager.getSessionFile()!, "utf8")).toBe(before);
	});
	it("confirmed interactive move synchronizes shell and status cwd and persists the same session", async () => {
		setThemeInstance((await getThemeByName("xcsh-dark"))!);
		const originalProject = getProjectDir();
		const originalShell = getShellPwd();
		const manager = SessionManager.create(cwdA);
		manager.appendMessage({ role: "user", content: "Synthetic move fixture", timestamp: 1 });
		await manager.ensureOnDisk();
		const identity = manager.getSessionId();
		const oldFile = manager.getSessionFile()!;
		const setCwd = vi.fn();
		const refresh = vi.fn(async (cwd: string) => {
			expect(cwd).toBe(cwdB);
			expect(getShellPwd()).toBe(cwdB);
			expect(getProjectDir()).toBe(cwdB);
			expect(setCwd).toHaveBeenLastCalledWith(cwdB);
			const reopened = await SessionManager.open(manager.getSessionFile()!);
			expect(reopened.getSessionId()).toBe(identity);
			expect(reopened.getCwd()).toBe(cwdB);
			expect(reopened.getEntries()).toHaveLength(1);
		});
		const ctx = {
			sessionManager: manager,
			session: { isStreaming: false },
			statusLine: { setCwd },
			updateEditorTopBorder: vi.fn(),
			refreshSlashCommandState: refresh,
			ui: { requestRender() {} },
			showStatus: vi.fn(),
			showError: vi.fn(),
			showHookCustom: (
				factory: (ui: unknown, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component,
			) =>
				new Promise(resolve => {
					const component = factory({ terminal: { rows: 24 }, requestRender() {} }, {}, {}, resolve);
					expect(manager.getCwd()).toBe(cwdA);
					expect(fs.existsSync(oldFile)).toBe(true);
					component.handleInput?.("\x1b[B");
					component.handleInput?.("\r");
				}),
		} as unknown as InteractiveModeContext;
		try {
			await new CommandController(ctx).handleMoveCommand(cwdB);
			expect(ctx.showError).not.toHaveBeenCalled();
			expect(refresh).toHaveBeenCalledTimes(1);
			expect(ctx.showStatus).toHaveBeenCalledWith(`Session moved to ${cwdB}.`);
			expect(fs.existsSync(oldFile)).toBe(false);
		} finally {
			setProjectDir(originalProject);
			setShellPwd(originalShell);
		}
	});
	it("reviewed move refuses occupied and changed destinations without altering the original", async () => {
		const session = SessionManager.create(cwdA);
		await session.ensureOnDisk();
		const oldFile = session.getSessionFile()!;
		const before = await fsp.readFile(oldFile, "utf8");
		const preview = session.previewMoveTo(cwdB);
		await expect(session.moveToReviewed(cwdB, { ...preview, sessionDir: "different" })).rejects.toThrow(
			"destination changed",
		);
		expect(fs.existsSync(preview.sessionDir)).toBe(false);
		await fsp.mkdir(preview.sessionDir, { recursive: true });
		await fsp.writeFile(preview.sessionFile!, "existing destination");
		await expect(session.moveToReviewed(cwdB, preview)).rejects.toThrow("already exists");
		expect(await fsp.readFile(oldFile, "utf8")).toBe(before);
		expect(await fsp.readFile(preview.sessionFile!, "utf8")).toBe("existing destination");
		expect(session.getCwd()).toBe(cwdA);
	});
	it("real failed move-header writes remain latched until explicit snapshot recovery succeeds", async () => {
		const storage = new FileSessionStorage();
		const session = SessionManager.create(cwdA, undefined, storage);
		session.appendMessage({ role: "user", content: "Before move", timestamp: 1 });
		await session.ensureOnDisk();
		const identity = session.getSessionId();
		const destination = session.previewMoveTo(cwdB);
		const rename = vi.spyOn(storage, "rename").mockRejectedValueOnce(new Error("Fixture atomic rename failure"));
		await expect(session.moveToReviewed(cwdB, destination)).rejects.toThrow("Fixture atomic rename failure");
		expect(session.getCwd()).toBe(cwdB);
		await expect(session.flush()).rejects.toThrow("Fixture atomic rename failure");
		const incomplete = await fsp.readFile(destination.sessionFile!, "utf8");
		rename.mockRejectedValueOnce(new Error("Fixture retry still offline"));
		await expect(session.retryPersistence()).rejects.toThrow("Fixture retry still offline");
		expect(await fsp.readFile(destination.sessionFile!, "utf8")).toBe(incomplete);
		await expect(session.flush()).rejects.toThrow();
		await session.retryPersistence();
		await session.flush();
		const reopened = await SessionManager.open(destination.sessionFile!);
		expect(reopened.getSessionId()).toBe(identity);
		expect(reopened.getCwd()).toBe(cwdB);
		expect(reopened.getEntries()).toHaveLength(1);
		session.appendMessage({ role: "user", content: "After recovery", timestamp: 2 });
		await session.flush();
		expect((await SessionManager.open(destination.sessionFile!)).getEntries()).toHaveLength(2);
	});
	it("snapshot recovery drains a failed append writer and does not duplicate messages", async () => {
		const storage = new FileSessionStorage();
		const open = storage.openWriter.bind(storage);
		let failNextSync = false;
		vi.spyOn(storage, "openWriter").mockImplementation((file, options) => {
			const writer = open(file, options);
			return {
				writeLine: value => writer.writeLine(value),
				flush: () => writer.flush(),
				close: () => writer.close(),
				getError: () => writer.getError(),
				fsync: async () => {
					if (failNextSync) {
						failNextSync = false;
						throw new Error("Fixture append fsync failure");
					}
					await writer.fsync();
				},
			};
		});
		const session = SessionManager.create(cwdA, undefined, storage);
		await session.ensureOnDisk();
		session.appendMessage({ role: "user", content: "Exactly once", timestamp: 1 });
		failNextSync = true;
		await expect(session.flush()).rejects.toThrow("Fixture append fsync failure");
		await session.retryPersistence();
		session.appendMessage({ role: "user", content: "After recovery", timestamp: 2 });
		await session.flush();
		expect((await SessionManager.open(session.getSessionFile()!)).getEntries()).toHaveLength(2);
	});

	it("succeeds on fresh session without ENOENT, then deferred persistence works", async () => {
		const session = SessionManager.create(cwdA);
		// No messages — file never written to disk
		const oldFile = session.getSessionFile()!;
		expect(fs.existsSync(oldFile)).toBe(false);

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		const newFile = session.getSessionFile()!;
		// Lazy-persist preserved: no header-only .jsonl created
		expect(fs.existsSync(newFile)).toBe(false);

		// Verify deferred persistence at the new path
		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage(makeAssistantMessage());
		await session.flush();

		expect(fs.existsSync(newFile)).toBe(true);
		const entries = await loadEntriesFromFile(newFile);
		const header = getHeader(entries);
		expect(header?.cwd).toBe(path.resolve(cwdB));
	});

	it("recreates file from memory when old file is deleted (assistant exists)", async () => {
		const session = SessionManager.create(cwdA);
		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });
		session.appendMessage(makeAssistantMessage());
		await session.flush();
		await session.close();

		const oldFile = session.getSessionFile()!;
		// Delete the file to simulate unexpected removal
		await fsp.unlink(oldFile);
		expect(fs.existsSync(oldFile)).toBe(false);

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		const newFile = session.getSessionFile()!;
		expect(fs.existsSync(newFile)).toBe(true);

		// Verify content recreated from memory
		const entries = await loadEntriesFromFile(newFile);
		const header = getHeader(entries);
		expect(header?.cwd).toBe(path.resolve(cwdB));
		expect(hasAssistantEntry(entries)).toBe(true);
	});

	it("moves header-only session and rewrites cwd", async () => {
		// Create a header-only session via open() with a non-existent explicit path
		const explicitPath = path.join(cwdA, "explicit-session.jsonl");
		const session = await SessionManager.open(explicitPath);

		expect(fs.existsSync(explicitPath)).toBe(true);

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		expect(fs.existsSync(explicitPath)).toBe(false);

		const newFile = session.getSessionFile()!;
		expect(fs.existsSync(newFile)).toBe(true);

		const entries = await loadEntriesFromFile(newFile);
		const header = getHeader(entries);
		expect(header?.cwd).toBe(path.resolve(cwdB));
	});

	it("moves header-only session with pending user message (#flushed regression)", async () => {
		// Create a header-only session
		const explicitPath = path.join(cwdA, "explicit-session-2.jsonl");
		const session = await SessionManager.open(explicitPath);

		expect(fs.existsSync(explicitPath)).toBe(true);

		// Add a user message only — _persist() sets #flushed=false (line 1827)
		session.appendMessage({ role: "user", content: "hello", timestamp: 1 });

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		expect(fs.existsSync(explicitPath)).toBe(false);

		const newFile = session.getSessionFile()!;
		expect(fs.existsSync(newFile)).toBe(true);

		// Rewrite must have run (hadSessionFile=true) even though #flushed was reset
		const entries = await loadEntriesFromFile(newFile);
		const header = getHeader(entries);
		expect(header?.cwd).toBe(path.resolve(cwdB));
	});

	it("moves artifact dir independently when session file does not exist", async () => {
		const session = SessionManager.create(cwdA);
		// Allocate an artifact — creates dir via ArtifactManager
		const { path: artifactPath } = await session.allocateArtifactPath("bash");
		if (!artifactPath) throw new Error("Expected artifact path");

		const oldArtifactDir = path.dirname(artifactPath);
		expect(fs.existsSync(oldArtifactDir)).toBe(true);

		// No messages — session file doesn't exist
		const oldFile = session.getSessionFile()!;
		expect(fs.existsSync(oldFile)).toBe(false);

		await session.moveTo(cwdB);

		expect(session.getCwd()).toBe(path.resolve(cwdB));
		// Old artifact dir moved
		expect(fs.existsSync(oldArtifactDir)).toBe(false);
		// New artifact dir exists
		const newFile = session.getSessionFile()!;
		const newArtifactDir = newFile.slice(0, -6); // strip .jsonl
		expect(fs.existsSync(newArtifactDir)).toBe(true);
	});
});
