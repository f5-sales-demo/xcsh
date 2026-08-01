/**
 * `chat_request.contextPaths` (Office `+` → Add a file/folder): the handler grants
 * the paths to the filesystem sandbox for the session and tells the model they're
 * available to read.
 */
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { composeChatPrompt, grantSandboxPaths, sanitizeContextPaths } from "../src/browser/chat-handler";
import { _resetSettingsForTest, Settings, settings } from "../src/config/settings";

afterEach(() => _resetSettingsForTest());

test("composeChatPrompt injects the attached paths as a read-me note (office/document host)", () => {
	const prompt = composeChatPrompt("what's in these?", null, "educational", "excel", [
		"/Users/me/proj",
		"/Users/me/notes.md",
	]);
	expect(prompt).toContain("The user attached these local paths");
	// Paths are JSON-escaped for an unambiguous boundary.
	expect(prompt).toContain('- "/Users/me/proj"');
	expect(prompt).toContain('- "/Users/me/notes.md"');
	// The user's actual message still trails the note.
	expect(prompt.trimEnd().endsWith("what's in these?")).toBe(true);
});

test("sanitizeContextPaths allows a real dir under an allowed base but REJECTS a symlink escaping it", () => {
	// A real dir under /tmp (an allowed base; /tmp→/private/tmp is realpath'd on both sides).
	const dir = fs.mkdtempSync("/tmp/xcsh-ctx-");
	// A symlink INSIDE that allowed dir pointing OUT to /etc — the classic escape.
	const escapeLink = path.join(dir, "escape");
	fs.symlinkSync("/etc", escapeLink);
	try {
		const realDir = fs.realpathSync(dir);
		const out = sanitizeContextPaths([
			dir, // real, under /tmp → allowed (canonicalized)
			escapeLink, // symlink → /etc → REJECTED (realpath escapes the base)
			"/etc/passwd", // outside bases → rejected
			"/", // root → rejected
			"relative/path", // not absolute → rejected
		]);
		expect(out).toContain(realDir);
		expect(out.some(p => p === "/etc" || p.startsWith("/etc/") || p.startsWith("/private/etc"))).toBe(false);
		expect(out).not.toContain("/");
		expect(out.some(p => !path.isAbsolute(p))).toBe(false);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("sanitizeContextPaths rejects control characters (prompt-injection vector) and dedupes real paths", () => {
	// Control-char rejection happens before any fs access.
	expect(sanitizeContextPaths(["/tmp/a\nrm -rf"])).toEqual([]);
	const dir = fs.mkdtempSync("/tmp/xcsh-dup-");
	try {
		expect(sanitizeContextPaths([dir, dir])).toEqual([fs.realpathSync(dir)]);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("composeChatPrompt with no contextPaths adds no note", () => {
	const prompt = composeChatPrompt("hi", null, "educational", "excel");
	expect(prompt).not.toContain("attached these local paths");
});

test("grantSandboxPaths appends to sandbox.allowRead (in-memory, deduped)", async () => {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: "/work", overrides: { "sandbox.allowRead": ["/existing"] } });

	grantSandboxPaths(["/Users/me/proj"]);
	expect(settings.get("sandbox.allowRead")).toEqual(["/existing", "/Users/me/proj"]);

	// Re-granting the same path is a no-op (deduped).
	grantSandboxPaths(["/Users/me/proj"]);
	expect(settings.get("sandbox.allowRead")).toEqual(["/existing", "/Users/me/proj"]);

	// A new path appends.
	grantSandboxPaths(["/Users/me/other"]);
	expect(settings.get("sandbox.allowRead")).toEqual(["/existing", "/Users/me/proj", "/Users/me/other"]);
});

test("grantSandboxPaths is best-effort when settings are uninitialized (does not throw)", () => {
	_resetSettingsForTest();
	expect(() => grantSandboxPaths(["/x"])).not.toThrow();
});
