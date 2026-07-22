import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import {
	getMemoriesDir,
	getPluginsDir,
	getSessionsDir,
	getXCSHContextsDir,
	setAgentDir,
} from "@f5-sales-demo/pi-utils";
import { buildDefaultSandboxPolicy, SandboxPolicy } from "@f5-sales-demo/xcsh/sandbox/policy";

/**
 * Build a hermetic policy from explicit rule roots — no filesystem, no globals.
 * Rule roots are matched with longest-prefix-wins; deny beats allow on a tie.
 */
function policy(read: Array<[string, boolean]>, write: Array<[string, boolean]>, enabled = true): SandboxPolicy {
	return new SandboxPolicy({
		enabled,
		cwd: "/work/custA",
		read: read.map(([root, allow]) => ({ root, allow })),
		write: write.map(([root, allow]) => ({ root, allow })),
	});
}

describe("SandboxPolicy (pure)", () => {
	it("allows everything when disabled", () => {
		const p = policy([["/work/custA", true]], [["/work/custA", true]], false);
		expect(p.isAllowed("/etc/passwd", "read")).toBe(true);
		expect(p.isAllowed("/anywhere/else", "write")).toBe(true);
	});

	it("allows paths inside the cwd subtree (including nested)", () => {
		const p = policy([["/work/custA", true]], [["/work/custA", true]]);
		expect(p.isAllowed("/work/custA", "read")).toBe(true);
		expect(p.isAllowed("/work/custA/notes.md", "read")).toBe(true);
		expect(p.isAllowed("/work/custA/deep/nested/file.txt", "write")).toBe(true);
	});

	it("blocks sibling customer folders", () => {
		const p = policy([["/work/custA", true]], [["/work/custA", true]]);
		expect(p.isAllowed("/work/custB/secrets.json", "read")).toBe(false);
		expect(p.isAllowed("/work/custB/secrets.json", "write")).toBe(false);
	});

	it("blocks parent and absolute escapes", () => {
		const p = policy([["/work/custA", true]], [["/work/custA", true]]);
		expect(p.isAllowed("/work", "read")).toBe(false);
		expect(p.isAllowed("/etc/passwd", "read")).toBe(false);
		expect(p.isAllowed("/work/custA/../custB/x", "read")).toBe(false); // resolves outside
	});

	it("parent-folder session sees all customer subfolders (automatic)", () => {
		const parent = new SandboxPolicy({
			enabled: true,
			cwd: "/work",
			read: [{ root: "/work", allow: true }],
			write: [{ root: "/work", allow: true }],
		});
		expect(parent.isAllowed("/work/custA/x", "read")).toBe(true);
		expect(parent.isAllowed("/work/custB/x", "read")).toBe(true);
	});

	it("longest-prefix wins: deny a subdir inside a broadly-allowed root", () => {
		const p = policy(
			[
				["/home/u/.xcsh", true], // broad allow (e.g. a misconfigured widening)
				["/home/u/.xcsh/agent/memories", false], // deeper deny
			],
			[["/work/custA", true]],
		);
		expect(p.isAllowed("/home/u/.xcsh/plugins/x", "read")).toBe(true);
		expect(p.isAllowed("/home/u/.xcsh/agent/memories/other/MEMORY.md", "read")).toBe(false);
	});

	it("deny wins on an exact-depth tie", () => {
		const p = policy(
			[
				["/x/y", true],
				["/x/y", false],
			],
			[["/work/custA", true]],
		);
		expect(p.isAllowed("/x/y/f", "read")).toBe(false);
	});

	it("default-denies paths matched by no rule", () => {
		const p = policy([["/work/custA", true]], [["/work/custA", true]]);
		expect(p.isAllowed("/opt/tool/data", "read")).toBe(false);
	});
});

describe("buildDefaultSandboxPolicy (wired to dirs)", () => {
	const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	let agentDir: string;

	beforeEach(() => {
		agentDir = path.join(os.tmpdir(), `xcsh-sbx-${process.pid}-${Math.floor(performance.now())}`, "agent");
		setAgentDir(agentDir);
	});

	afterEach(() => {
		if (savedAgentDir) setAgentDir(savedAgentDir);
	});

	it("allows the cwd subtree and the plugin cache for reads", () => {
		const cwd = "/work/custA";
		const p = buildDefaultSandboxPolicy({ cwd });
		expect(p.isAllowed(path.join(cwd, "file.md"), "read")).toBe(true);
		expect(p.isAllowed(path.join(getPluginsDir(), "cache/plugins/meddpicc/engine/cli.ts"), "read")).toBe(true);
	});

	it("denies other sessions' memories, sessions, and global tenant contexts", () => {
		const p = buildDefaultSandboxPolicy({ cwd: "/work/custA" });
		expect(p.isAllowed(path.join(getMemoriesDir(), "--work-custB--", "MEMORY.md"), "read")).toBe(false);
		expect(p.isAllowed(path.join(getSessionsDir(), "-other", "s.jsonl"), "read")).toBe(false);
		expect(p.isAllowed(path.join(getXCSHContextsDir(), "acme.json"), "read")).toBe(false);
	});

	it("confines writes to the cwd subtree (plugin cache is read-only)", () => {
		const cwd = "/work/custA";
		const p = buildDefaultSandboxPolicy({ cwd });
		expect(p.isAllowed(path.join(cwd, "out.txt"), "write")).toBe(true);
		expect(p.isAllowed(path.join(getPluginsDir(), "x"), "write")).toBe(false);
	});

	it("honors extraAllowRoots (--allow-path) for cross-customer parent tasks", () => {
		const p = buildDefaultSandboxPolicy({ cwd: "/work/custA", extraAllowRoots: ["/shared/ref"] });
		expect(p.isAllowed("/shared/ref/data.csv", "read")).toBe(true);
		expect(p.isAllowed("/shared/ref/data.csv", "write")).toBe(true);
	});

	it("honors configured denyRead overriding an allow within the cwd", () => {
		const cwd = "/work/custA";
		const p = buildDefaultSandboxPolicy({ cwd, denyRead: [path.join(cwd, "vault")] });
		expect(p.isAllowed(path.join(cwd, "ok.md"), "read")).toBe(true);
		expect(p.isAllowed(path.join(cwd, "vault", "key.pem"), "read")).toBe(false);
	});
});
