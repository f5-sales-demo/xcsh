import { describe, expect, it } from "bun:test";
import { resolveSessionPolicy, type SettingsReader } from "@f5-sales-demo/xcsh/sandbox/session-policy";

/** A settings reader over a plain record, standing in for one session's Settings instance. */
function reader(values: Record<string, unknown>): SettingsReader {
	return { get: key => values[key] };
}

/** A reader that throws, as the global proxy does before Settings.init(). */
const throwingReader: SettingsReader = {
	get() {
		throw new Error("settings not initialized");
	},
};

describe("resolveSessionPolicy", () => {
	it("returns undefined when the sandbox is disabled", () => {
		expect(resolveSessionPolicy("/work/custA", reader({ "sandbox.enabled": false }))).toBeUndefined();
	});

	it("fails closed when the setting cannot be read", () => {
		const policy = resolveSessionPolicy("/work/custA", throwingReader);
		expect(policy).toBeDefined();
		expect(policy?.isAllowed("/work/custB/x", "read")).toBe(false);
	});

	it("confines reads and writes to the given cwd", () => {
		const policy = resolveSessionPolicy("/work/custA", reader({}));
		expect(policy?.isAllowed("/work/custA/notes.md", "read")).toBe(true);
		expect(policy?.isAllowed("/work/custB/notes.md", "read")).toBe(false);
		expect(policy?.isAllowed("/work/custA/out.ts", "write")).toBe(true);
	});

	it("honours the allow-lists", () => {
		const policy = resolveSessionPolicy("/work/custA", reader({ "sandbox.allowRead": ["/shared/ctx"] }));
		expect(policy?.isAllowed("/shared/ctx/file.md", "read")).toBe(true);
		expect(policy?.isAllowed("/shared/ctx/file.md", "write")).toBe(false);
	});

	// Two sessions can share a cwd and differ in sandbox settings — createAgentSession accepts an
	// isolated Settings instance. A cwd-keyed cache would hand one session the other's boundary.
	it("distinguishes same-cwd sessions whose settings differ", () => {
		const permissive = resolveSessionPolicy("/work/custA", reader({ "sandbox.allowRead": ["/shared/ctx"] }));
		const strict = resolveSessionPolicy("/work/custA", reader({}));

		expect(permissive?.isAllowed("/shared/ctx/file.md", "read")).toBe(true);
		expect(strict?.isAllowed("/shared/ctx/file.md", "read")).toBe(false);
		expect(permissive).not.toBe(strict);
	});

	it("reuses the policy for an identical configuration", () => {
		const first = resolveSessionPolicy("/work/cached", reader({ "sandbox.allowRead": ["/a"] }));
		const second = resolveSessionPolicy("/work/cached", reader({ "sandbox.allowRead": ["/a"] }));
		expect(first).toBe(second);
	});

	it("rebuilds when an allow-list is widened mid-session", () => {
		const before = resolveSessionPolicy("/work/widen", reader({}));
		const after = resolveSessionPolicy("/work/widen", reader({ "sandbox.allowRead": ["/granted"] }));
		expect(before?.isAllowed("/granted/x", "read")).toBe(false);
		expect(after?.isAllowed("/granted/x", "read")).toBe(true);
	});
});
