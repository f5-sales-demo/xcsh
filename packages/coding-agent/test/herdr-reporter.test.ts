import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
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

/** A ctx whose read-only session manager exposes a session file path and/or id. */
const sessionCtx = (file: string | undefined, id = ""): ExtensionContext =>
	({
		isIdle: () => true,
		sessionManager: { getSessionFile: () => file, getSessionId: () => id },
	}) as unknown as ExtensionContext;

/** A throwaway unix-socket server that records the JSON-RPC requests it receives. */
interface FakeHerdr {
	socketPath: string;
	received: Array<{ id: string; method: string; params: Record<string, unknown> }>;
	close: () => Promise<void>;
}

function startFakeHerdr(): Promise<FakeHerdr> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-sock-"));
	const socketPath = path.join(dir, "herdr.sock");
	const received: FakeHerdr["received"] = [];
	const sockets = new Set<net.Socket>();
	const server = net.createServer(sock => {
		sockets.add(sock);
		sock.on("close", () => sockets.delete(sock));
		sock.on("error", () => {});
		let buf = "";
		sock.on("data", chunk => {
			buf += chunk.toString();
			let nl = buf.indexOf("\n");
			while (nl >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				if (line.trim()) received.push(JSON.parse(line));
				nl = buf.indexOf("\n");
			}
		});
	});
	return new Promise(resolve => {
		server.listen(socketPath, () => {
			resolve({
				socketPath,
				received,
				// Destroy any fire-and-forget client sockets so server.close() completes.
				close: () =>
					new Promise<void>(res => {
						for (const s of sockets) s.destroy();
						server.close(() => {
							fs.rmSync(dir, { recursive: true, force: true });
							res();
						});
					}),
			});
		});
	});
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
		await new Promise(r => setTimeout(r, 10));
	}
}

const reportMsg = (state: string, seq: number) => ({
	id: "xcsh:herdr-reporter",
	method: "pane.report_agent",
	params: { pane_id: "w1:p1", source: "herdr:xcsh", agent: "xcsh", state, seq },
});

/** seq is seeded from the wall clock, so assert offsets from the first frame. */
const baseSeq = (herdr: FakeHerdr): number => herdr.received[0]?.params.seq as number;

describe("herdr-reporter extension", () => {
	const originalPaneId = process.env.HERDR_PANE_ID;
	const originalSocket = process.env.HERDR_SOCKET_PATH;

	afterEach(() => {
		if (originalPaneId === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = originalPaneId;
		if (originalSocket === undefined) delete process.env.HERDR_SOCKET_PATH;
		else process.env.HERDR_SOCKET_PATH = originalSocket;
	});

	it("is inert (registers nothing) when not running under herdr", () => {
		delete process.env.HERDR_PANE_ID;
		const { pi, handlers, labels, execCalls } = makeMockPi();

		herdrReporter(pi);

		expect(handlers.size).toBe(0);
		expect(labels).toEqual([]);
		expect(execCalls).toEqual([]);
	});

	it("reports the full state lifecycle over HERDR_SOCKET_PATH (no herdr CLI)", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers, execCalls, labels } = makeMockPi();

			herdrReporter(pi);
			expect(labels).toEqual(["xcsh"]);

			await handlers.get("session_start")?.({}, idleCtx);
			await handlers.get("agent_start")?.({}, idleCtx);
			await handlers.get("agent_end")?.({ messages: [] }, idleCtx);

			await waitFor(() => herdr.received.length >= 3);
			const base = baseSeq(herdr);
			expect(herdr.received[0]).toEqual(reportMsg("idle", base));
			expect(herdr.received[1]).toEqual(reportMsg("working", base + 1));
			expect(herdr.received[2]).toEqual(reportMsg("idle", base + 2));
			// Socket transport must not shell out to the CLI.
			expect(execCalls).toEqual([]);
		} finally {
			await herdr.close();
		}
	});

	it("reports blocked over the socket while a prompt is open, then restores state", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);

			await handlers.get("user_prompt_start")?.({ kind: "select" }, busyCtx);
			await handlers.get("agent_end")?.({ messages: [] }, busyCtx);
			await handlers.get("user_prompt_end")?.({ kind: "select" }, busyCtx);

			await waitFor(() => herdr.received.length >= 3);
			const base = baseSeq(herdr);
			expect(herdr.received[0]).toEqual(reportMsg("blocked", base));
			expect(herdr.received[1]).toEqual(reportMsg("blocked", base + 1));
			expect(herdr.received[2]).toEqual(reportMsg("working", base + 2));
		} finally {
			await herdr.close();
		}
	});

	it("releases pane authority over the socket on shutdown", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			await handlers.get("session_shutdown")?.({}, idleCtx);

			await waitFor(() => herdr.received.length >= 1);
			expect(herdr.received[0]).toEqual({
				id: "xcsh:herdr-reporter",
				method: "pane.release_agent",
				params: { pane_id: "w1:p1", source: "herdr:xcsh", agent: "xcsh", seq: baseSeq(herdr) },
			});
		} finally {
			await herdr.close();
		}
	});

	it("falls back to the herdr CLI when HERDR_SOCKET_PATH is unset", async () => {
		process.env.HERDR_PANE_ID = "w1:p1";
		delete process.env.HERDR_SOCKET_PATH;
		const { pi, handlers, execCalls } = makeMockPi();

		herdrReporter(pi);
		await handlers.get("agent_start")?.({}, idleCtx);
		await handlers.get("session_shutdown")?.({}, idleCtx);
		await waitFor(() => execCalls.length >= 2);

		const cliSeq = (call: { args: string[] }): number => Number(call.args[call.args.indexOf("--seq") + 1]);
		const base = cliSeq(execCalls[0]!);
		expect(base).toBeGreaterThan(0);
		expect(execCalls[0]).toEqual({
			command: "herdr",
			args: [
				"pane",
				"report-agent",
				"w1:p1",
				"--source",
				"herdr:xcsh",
				"--agent",
				"xcsh",
				"--state",
				"working",
				"--seq",
				String(base),
			],
		});
		expect(execCalls[1]).toEqual({
			command: "herdr",
			args: [
				"pane",
				"release-agent",
				"w1:p1",
				"--source",
				"herdr:xcsh",
				"--agent",
				"xcsh",
				"--seq",
				String(base + 1),
			],
		});
	});

	it("reports session identity (absolute path) on session_start over the socket", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			const file = "/Users/example/.xcsh/agent/sessions/-proj/2026-07-23T00-00-00Z_abc.jsonl";
			await handlers.get("session_start")?.({}, sessionCtx(file));

			await waitFor(() => herdr.received.some(m => m.method === "pane.report_agent_session"));
			const frame = herdr.received.find(m => m.method === "pane.report_agent_session");
			expect(frame?.params).toMatchObject({
				pane_id: "w1:p1",
				source: "herdr:xcsh",
				agent: "xcsh",
				agent_session_path: file,
			});
			expect(frame?.params.agent_session_id).toBeUndefined();

			// It still reports live state, tagged with the herdr:xcsh source.
			await waitFor(() => herdr.received.some(m => m.method === "pane.report_agent"));
			const state = herdr.received.find(m => m.method === "pane.report_agent");
			expect(state?.params).toMatchObject({ source: "herdr:xcsh", agent: "xcsh", state: "idle" });
		} finally {
			await herdr.close();
		}
	});

	it("falls back to the session id when no session file path is available", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			await handlers.get("session_start")?.({}, sessionCtx(undefined, "sess-123"));

			await waitFor(() => herdr.received.some(m => m.method === "pane.report_agent_session"));
			const frame = herdr.received.find(m => m.method === "pane.report_agent_session");
			expect(frame?.params).toMatchObject({ source: "herdr:xcsh", agent: "xcsh", agent_session_id: "sess-123" });
			expect(frame?.params.agent_session_path).toBeUndefined();
		} finally {
			await herdr.close();
		}
	});

	it("does not send a session frame when the session is not persisted", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			// No session file and no id: only the state report should be sent.
			await handlers.get("session_start")?.({}, sessionCtx(undefined, ""));

			await waitFor(() => herdr.received.some(m => m.method === "pane.report_agent"));
			expect(herdr.received.some(m => m.method === "pane.report_agent_session")).toBe(false);
		} finally {
			await herdr.close();
		}
	});

	it("seeds seq from a clock so a restarted xcsh process outranks the previous one", async () => {
		// herdr keys hook_report_sequences by source and rejects seq <= last_seq. A
		// per-process counter starting at 0 means a restarted xcsh can never
		// out-rank its predecessor in the same pane, so every one of its reports is
		// silently dropped. pi/omp seed from Date.now() * 1000 for this reason.
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const lowerBound = Date.now() * 1000;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			await handlers.get("session_start")?.({}, idleCtx);
			await waitFor(() => herdr.received.length >= 1);
			const upperBound = Date.now() * 1000 + 1_000_000;

			const firstSeq = herdr.received[0]?.params.seq as number;
			expect(firstSeq).toBeGreaterThanOrEqual(lowerBound);
			expect(firstSeq).toBeLessThanOrEqual(upperBound);
		} finally {
			await herdr.close();
		}
	});

	it("delivers the state frame before the session frame, with an ascending seq", async () => {
		// herdr drops a session frame for a pane whose agent it does not yet own, so
		// the state frame must establish herdr:xcsh first. Verified against a live
		// herdr: session-then-state leaves agent_session null even when seq ascends.
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			await handlers.get("session_start")?.({}, sessionCtx("/tmp/x/session.jsonl"));

			await waitFor(() => herdr.received.length >= 2);
			expect(herdr.received[0]?.method).toBe("pane.report_agent");
			expect(herdr.received[1]?.method).toBe("pane.report_agent_session");
			expect(herdr.received[1]?.params.seq as number).toBeGreaterThan(herdr.received[0]?.params.seq as number);
		} finally {
			await herdr.close();
		}
	});

	it("reports the session ref once the session file appears later", async () => {
		// xcsh creates the session .jsonl lazily, so getSessionFile() can still be
		// undefined at session_start and at agent_start. The ref must be picked up
		// on a later lifecycle event instead of being lost until the next turn.
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			let file: string | undefined;
			const lazyCtx = {
				isIdle: () => true,
				sessionManager: { getSessionFile: () => file, getSessionId: () => "" },
			} as unknown as ExtensionContext;

			herdrReporter(pi);
			await handlers.get("session_start")?.({}, lazyCtx);
			await handlers.get("agent_start")?.({}, lazyCtx);
			file = "/tmp/x/late-session.jsonl";
			await handlers.get("agent_end")?.({ messages: [] }, lazyCtx);

			await waitFor(() => herdr.received.some(r => r.method === "pane.report_agent_session"));
			const session = herdr.received.find(r => r.method === "pane.report_agent_session");
			expect(session?.params.agent_session_path).toBe("/tmp/x/late-session.jsonl");
		} finally {
			await herdr.close();
		}
	});

	it("ships as a bundled extension and registers handlers under herdr", async () => {
		process.env.HERDR_PANE_ID = "pane-x";
		const tempDir = TempDir.createSync("@herdr-ext-");
		try {
			const result = await discoverAndLoadExtensions([], tempDir.path());
			const bundled = result.extensions.find(ext => ext.path === "bundled:herdr-reporter");
			expect(bundled).toBeDefined();
			expect(bundled?.handlers.has("agent_start")).toBe(true);
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
