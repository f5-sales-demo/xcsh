/**
 * `chat_request.contextPaths` (Office `+` → Add a file/folder): the handler grants
 * the paths to the filesystem sandbox for the session and tells the model they're
 * available to read.
 */
import { afterEach, expect, test } from "bun:test";
import { composeChatPrompt, grantSandboxPaths } from "@f5-sales-demo/xcsh/browser/chat-handler";
import { _resetSettingsForTest, Settings, settings } from "@f5-sales-demo/xcsh/config/settings";

afterEach(() => _resetSettingsForTest());

test("composeChatPrompt injects the attached paths as a read-me note (office/document host)", () => {
	const prompt = composeChatPrompt("what's in these?", null, "educational", "excel", [
		"/Users/me/proj",
		"/Users/me/notes.md",
	]);
	expect(prompt).toContain("The user attached these local paths");
	expect(prompt).toContain("- /Users/me/proj");
	expect(prompt).toContain("- /Users/me/notes.md");
	// The user's actual message still trails the note.
	expect(prompt.trimEnd().endsWith("what's in these?")).toBe(true);
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
