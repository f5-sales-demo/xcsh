import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fenceVerdict } from "../src/sandbox/containment";
import { resolveSessionFence, type SettingsReader } from "../src/sandbox/session-fence";

/**
 * Real directories, because a fence is built from canonical paths and refuses to build on one it cannot
 * resolve — a rule that appears to enforce and does not is the worst outcome available, so the fence
 * would rather throw. The synthetic `/work/custA` these tests used to pass around only worked because
 * the policy they replaced never touched the filesystem.
 */
/** Fixture containers, removed after the file runs — these leaked 78 `sf-*` directories (#2633). */
const fixtures: string[] = [];

afterAll(() => {
	for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
	fixtures.length = 0;
});

function tenants(suffix: string): { mine: string; theirs: string; shared: string } {
	const container = fs.realpathSync(
		fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `xcsh-sessfence-${suffix}-`)),
	);
	fixtures.push(container);
	const mine = path.join(container, "custA");
	const theirs = path.join(container, "custB");
	// Beside the tenants, so the ancestor walk denies it by default and an allow-list has something to
	// actually widen. A temp directory elsewhere would not work: siblings of the temp root match no rule
	// and are already allowed, so every "granted" assertion would pass before the grant existed.
	const shared = path.join(container, "shared");
	for (const dir of [mine, theirs, shared]) fs.mkdirSync(dir);
	return { mine, theirs, shared };
}

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

describe("resolveSessionFence", () => {
	it("returns undefined when the sandbox is disabled", () => {
		const { mine } = tenants("off");
		expect(resolveSessionFence(mine, reader({ "sandbox.enabled": false }))).toBeUndefined();
	});

	it("fails closed when the setting cannot be read", () => {
		const { mine, theirs } = tenants("throw");
		const fence = resolveSessionFence(mine, throwingReader);
		expect(fence).toBeDefined();
		expect(fenceVerdict(fence!, path.join(theirs, "x"), "read")).toBe("deny");
	});

	it("denies the neighbouring tenant while the workspace works", () => {
		const { mine, theirs } = tenants("basic");
		const fence = resolveSessionFence(mine, reader({}))!;
		expect(fenceVerdict(fence, path.join(mine, "notes.md"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(mine, "out.ts"), "write")).toBe("allow");
		expect(fenceVerdict(fence, path.join(theirs, "notes.md"), "read")).toBe("deny");
	});

	// Allow-by-default is the posture now, so a path under no rule at all is reachable. That is the
	// point of #2624 rather than an oversight: `/usr`, `/etc` and the temp dirs hold no customer
	// material, and refusing them only produced diagnostics that contradicted the documentation.
	it("leaves operational paths alone", () => {
		const { mine } = tenants("operational");
		const fence = resolveSessionFence(mine, reader({}))!;
		for (const operational of ["/usr/bin/env", "/etc/hosts", "/dev/null"]) {
			expect(fenceVerdict(fence, operational, "read")).toBe("allow");
		}
	});

	it("honours the allow-lists", () => {
		const { mine, shared } = tenants("lists");
		const fence = resolveSessionFence(mine, reader({ "sandbox.allowRead": [shared] }))!;
		expect(fenceVerdict(fence, path.join(shared, "file.md"), "read")).toBe("allow");
		expect(fenceVerdict(fence, path.join(shared, "file.md"), "write")).toBe("deny");
	});

	// Two sessions can share a cwd and differ in sandbox settings — createAgentSession accepts an
	// isolated Settings instance. A cwd-keyed cache would hand one session the other's boundary.
	it("distinguishes same-cwd sessions whose settings differ", () => {
		const { mine, shared } = tenants("samecwd");
		const permissive = resolveSessionFence(mine, reader({ "sandbox.allowRead": [shared] }))!;
		const strict = resolveSessionFence(mine, reader({}))!;

		expect(fenceVerdict(permissive, path.join(shared, "file.md"), "read")).toBe("allow");
		expect(fenceVerdict(strict, path.join(shared, "file.md"), "read")).toBe("deny");
		expect(permissive).not.toBe(strict);
	});

	it("reuses the fence for an identical configuration", () => {
		const { mine, shared } = tenants("cached");
		const first = resolveSessionFence(mine, reader({ "sandbox.allowRead": [shared] }));
		const second = resolveSessionFence(mine, reader({ "sandbox.allowRead": [shared] }));
		expect(first).toBe(second);
	});

	it("rebuilds when an allow-list is widened mid-session", () => {
		const { mine, shared } = tenants("widen");
		const before = resolveSessionFence(mine, reader({}))!;
		const after = resolveSessionFence(mine, reader({ "sandbox.allowRead": [shared] }))!;
		expect(fenceVerdict(before, path.join(shared, "x"), "read")).toBe("deny");
		expect(fenceVerdict(after, path.join(shared, "x"), "read")).toBe("allow");
	});

	// The bash tool passes its artifacts dir here rather than building a second fence of its own, which
	// is what let the two disagree before. A different extras value must not be served from cache.
	it("keys the cache on extra roots too", () => {
		const { mine, shared: artifacts } = tenants("extras");
		const without = resolveSessionFence(mine, reader({}))!;
		const with_ = resolveSessionFence(mine, reader({}), { extraRoots: [artifacts] })!;
		expect(without).not.toBe(with_);
		expect(fenceVerdict(without, path.join(artifacts, "out.txt"), "write")).toBe("deny");
		expect(fenceVerdict(with_, path.join(artifacts, "out.txt"), "write")).toBe("allow");
	});
});
