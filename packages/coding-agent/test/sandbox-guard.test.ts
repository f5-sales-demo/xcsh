import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSessionsDir } from "@f5-sales-demo/pi-utils";
import { _resetSettingsForTest, Settings, settings } from "../src/config/settings";
import sandboxGuard from "../src/extensibility/extensions/bundled/sandbox-guard";

/**
 * Real directories, because the guard now resolves a `ContainmentFence` and a fence refuses to build on
 * a workspace it cannot canonicalise — it would rather throw than emit rules that silently match
 * nothing (#2624). The synthetic `/work/custA` this used only worked against the policy it replaced.
 *
 * Two tenants under one container, which is the shape the fence covers by denying the container.
 */
let CWD: string;
let OTHER: string;
/** Removed after the file runs; these leaked `guard-*` directories into the OS temp dir (#2633). */
let container: string;

afterAll(() => fs.rmSync(container, { recursive: true, force: true }));

beforeAll(() => {
	container = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "xcsh-guard-")));
	CWD = path.join(container, "custA");
	OTHER = path.join(container, "custB");
	fs.mkdirSync(CWD);
	fs.mkdirSync(OTHER);
});

interface ToolCallEvent {
	type: "tool_call";
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}
type Handler = (event: ToolCallEvent, ctx: { cwd: string }) => unknown;

/** Invoke the factory with a stub `pi` and capture its tool_call handler. */
function captureHandler(): Handler | undefined {
	let handler: Handler | undefined;
	const pi = {
		on(event: string, h: Handler) {
			if (event === "tool_call") handler = h;
		},
	};
	sandboxGuard(pi as unknown as Parameters<typeof sandboxGuard>[0]);
	return handler;
}

async function initSandbox(enabled: boolean): Promise<void> {
	_resetSettingsForTest();
	await Settings.init({ inMemory: true, cwd: CWD, overrides: { "sandbox.enabled": enabled } });
}

function call(handler: Handler, toolName: string, input: Record<string, unknown>): unknown {
	return handler({ type: "tool_call", toolName, toolCallId: "1", input }, { cwd: CWD });
}

describe("sandbox-guard bundled extension", () => {
	afterEach(() => _resetSettingsForTest());

	it("registers a tool_call handler", () => {
		expect(typeof captureHandler()).toBe("function");
	});

	it("blocks enumeration of the session root's parent when enabled", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: container })).toMatchObject({ block: true });
	});

	it("allows an in-tree read when enabled", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: "notes.md" })).toBeUndefined();
	});

	it("is a no-op when sandbox.enabled is false (--no-sandbox)", async () => {
		await initSandbox(false);
		const handler = captureHandler()!;
		expect(await call(handler, "read", { file_path: path.join(OTHER, "secret") })).toBeUndefined();
	});

	it("honors a MID-SESSION parent-enumeration grant (settings.override busts the fence cache)", async () => {
		await initSandbox(true);
		const handler = captureHandler()!;
		// First call caches the fence; the parent cannot be enumerated.
		expect(await call(handler, "read", { file_path: container })).toMatchObject({ block: true });
		// The user grants the parent at runtime. A cwd-only cache would keep blocking; the
		// allow-list-keyed cache rebuilds and restores enumeration.
		settings.override("sandbox.allowRead", [container]);
		expect(await call(handler, "read", { file_path: container })).toBeUndefined();
		// Revoking it re-blocks (cache tracks the current allow-list, not a one-way widen).
		settings.override("sandbox.allowRead", []);
		expect(await call(handler, "read", { file_path: container })).toMatchObject({ block: true });
	});

	/**
	 * #2624, at the layer that shipped the divergence.
	 *
	 * This guard is what refused a `/tmp` write and a `~/.gitconfig` read on v19.100.0 — operations the
	 * fence permits and `xcsh://about` promises. It used to ask whether an OS backend was confining the
	 * shell and stand aside for `bash` when one was, which meant the answer to "is this path reachable"
	 * depended on the platform. Now there is one fence for every tool, so the same path gets the same
	 * answer whichever tool asks and whatever backend is running.
	 */
	describe("one boundary for every tool", () => {
		it("permits the operational paths the fence permits, for bash", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			for (const command of ["printf x > /tmp/xcsh-guard-probe.txt", "cat /etc/hosts"]) {
				expect(await call(handler, "bash", { command })).toBeUndefined();
			}
		});

		// The same paths, through the tools that have no subprocess to confine. Answering differently is
		// what taught the model to retry a refused read through the shell.
		it("permits them for python and the structured file tools too", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			expect(await call(handler, "python", { code: 'open("/etc/hosts").read()' })).toBeUndefined();
			expect(await call(handler, "read", { file_path: "/etc/hosts" })).toBeUndefined();
			expect(await call(handler, "write", { file_path: "/tmp/xcsh-guard-probe.txt" })).toBeUndefined();
		});

		it("preserves named sibling reads and writes through every interface", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			const secret = path.join(OTHER, "secret");
			expect(await call(handler, "bash", { command: `cat ${secret}` })).toBeUndefined();
			expect(await call(handler, "python", { code: `open("${secret}").read()` })).toBeUndefined();
			expect(await call(handler, "read", { file_path: secret })).toBeUndefined();
			expect(await call(handler, "write", { file_path: path.join(OTHER, "planted") })).toBeUndefined();
		});

		// Cross-session state remains a real deny, independent of the discovery-only sibling courtesy.
		it("refuses another session's state through bash, python and the file tools", async () => {
			await initSandbox(true);
			const handler = captureHandler()!;
			const secret = path.join(getSessionsDir(), "other-session.jsonl");
			expect(await call(handler, "bash", { command: `cat ${secret}` })).toMatchObject({ block: true });
			expect(await call(handler, "python", { code: `open("${secret}").read()` })).toMatchObject({ block: true });
			expect(await call(handler, "read", { file_path: secret })).toMatchObject({ block: true });
			expect(
				await call(handler, "write", { file_path: path.join(getSessionsDir(), "planted.jsonl") }),
			).toMatchObject({ block: true });
		});
	});
});
