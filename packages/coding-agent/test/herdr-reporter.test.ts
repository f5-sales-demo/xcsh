import { afterEach, describe, expect, it } from "bun:test";
import { TempDir } from "@f5-sales-demo/pi-utils";
import type { ExtensionAPI, ExtensionContext } from "@f5-sales-demo/xcsh";
import herdrReporter from "@f5-sales-demo/xcsh/extensibility/extensions/bundled/herdr-reporter";
import { discoverAndLoadExtensions } from "@f5-sales-demo/xcsh/extensibility/extensions/loader";
import { filterUserExtensions } from "./utils/filter-user-extensions";

type AnyHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

interface MockPi {
	pi: ExtensionAPI;
	handlers: Map<string, AnyHandler>;
	execCalls: Array<{ command: string; args: string[] }>;
	labels: string[];
}

function makeMockPi(): MockPi {
	const handlers = new Map<string, AnyHandler>();
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const labels: string[] = [];

	const pi = {
		on(event: string, handler: AnyHandler) {
			handlers.set(event, handler);
		},
		setLabel(label: string) {
			labels.push(label);
		},
		exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
		},
		logger: { debug() {}, info() {}, warn() {}, error() {} },
	} as unknown as ExtensionAPI;

	return { pi, handlers, execCalls, labels };
}

const idleCtx = { isIdle: () => true } as unknown as ExtensionContext;
const busyCtx = { isIdle: () => false } as unknown as ExtensionContext;

const reportArgs = (state: string, seq: string): string[] => [
	"pane",
	"report-agent",
	"pane-1",
	"--source",
	"xcsh",
	"--agent",
	"xcsh",
	"--state",
	state,
	"--seq",
	seq,
];

describe("herdr-reporter extension", () => {
	const originalPaneId = process.env.HERDR_PANE_ID;

	afterEach(() => {
		if (originalPaneId === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = originalPaneId;
	});

	it("is inert (registers nothing) when not running under herdr", () => {
		delete process.env.HERDR_PANE_ID;
		const { pi, handlers, labels, execCalls } = makeMockPi();

		herdrReporter(pi);

		expect(handlers.size).toBe(0);
		expect(labels).toEqual([]);
		expect(execCalls).toEqual([]);
	});

	it("labels itself xcsh and reports the full state lifecycle under herdr", async () => {
		process.env.HERDR_PANE_ID = "pane-1";
		const { pi, handlers, execCalls, labels } = makeMockPi();

		herdrReporter(pi);

		expect(labels).toEqual(["xcsh"]);

		await handlers.get("session_start")?.({}, idleCtx);
		await handlers.get("agent_start")?.({}, idleCtx);
		await handlers.get("agent_end")?.({ messages: [] }, idleCtx);

		expect(execCalls[0]).toEqual({ command: "herdr", args: reportArgs("idle", "0") });
		expect(execCalls[1]).toEqual({ command: "herdr", args: reportArgs("working", "1") });
		expect(execCalls[2]).toEqual({ command: "herdr", args: reportArgs("idle", "2") });
	});

	it("reports blocked while a prompt is open, then restores working/idle", async () => {
		process.env.HERDR_PANE_ID = "pane-1";
		const { pi, handlers, execCalls } = makeMockPi();

		herdrReporter(pi);

		await handlers.get("user_prompt_start")?.({ kind: "select" }, busyCtx);
		expect(execCalls.at(-1)).toEqual({ command: "herdr", args: reportArgs("blocked", "0") });

		// agent_end while a prompt is still open stays blocked, not idle.
		await handlers.get("agent_end")?.({ messages: [] }, busyCtx);
		expect(execCalls.at(-1)).toEqual({ command: "herdr", args: reportArgs("blocked", "1") });

		// prompt resolves while still streaming -> working.
		await handlers.get("user_prompt_end")?.({ kind: "select" }, busyCtx);
		expect(execCalls.at(-1)).toEqual({ command: "herdr", args: reportArgs("working", "2") });
	});

	it("releases pane authority on shutdown", async () => {
		process.env.HERDR_PANE_ID = "pane-1";
		const { pi, handlers, execCalls } = makeMockPi();

		herdrReporter(pi);
		await handlers.get("session_shutdown")?.({}, idleCtx);

		expect(execCalls.at(-1)).toEqual({
			command: "herdr",
			args: ["pane", "release-agent", "pane-1", "--source", "xcsh", "--agent", "xcsh", "--seq", "0"],
		});
	});

	it("ships as a bundled extension and registers handlers under herdr", async () => {
		process.env.HERDR_PANE_ID = "pane-x";
		const tempDir = TempDir.createSync("@herdr-ext-");
		try {
			const result = await discoverAndLoadExtensions([], tempDir.path());
			const bundled = result.extensions.find(ext => ext.path === "bundled:herdr-reporter");
			expect(bundled).toBeDefined();
			expect(bundled?.handlers.has("agent_start")).toBe(true);
			// bundled extensions are not user-authored, so the user filter drops them.
			expect(filterUserExtensions(result.extensions).some(e => e.path === "bundled:herdr-reporter")).toBe(false);
		} finally {
			tempDir.removeSync();
		}
	});

	it("ships as a bundled extension but stays inert without herdr", async () => {
		delete process.env.HERDR_PANE_ID;
		const tempDir = TempDir.createSync("@herdr-ext-");
		try {
			const result = await discoverAndLoadExtensions([], tempDir.path());
			const bundled = result.extensions.find(ext => ext.path === "bundled:herdr-reporter");
			expect(bundled).toBeDefined();
			expect(bundled?.handlers.size).toBe(0);
		} finally {
			tempDir.removeSync();
		}
	});
});
