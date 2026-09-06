import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { TempDir } from "@f5-sales-demo/pi-utils";
import type { ExtensionAPI, ExtensionContext } from "@f5-sales-demo/xcsh";
import herdrReporter from "../src/extensibility/extensions/bundled/herdr-reporter";
import { discoverAndLoadExtensions } from "../src/extensibility/extensions/loader";
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
	received: Array<{ id: string; method: string; params: Record<string, unknown>; order: number }>;
	/** Order index (shared with `received[].order`) of each accepted `ping` handshake. */
	pingOrders: number[];
	close: () => Promise<void>;
}

/**
 * A throwaway Herdr protocol-18 socket server. Mirrors the real herdr handshake
 * gate: the very first request on the server must be a `ping`, which is
 * answered with a matching `pong`; every other method is rejected with a
 * JSON-RPC error and NOT recorded until a successful ping has been observed.
 * This lets tests prove a client performs the protocol-18 handshake before
 * sending lifecycle frames, exactly as `HerdrClient.ensureProtocol()` does —
 * a client that skips the handshake (e.g. the old raw-socket transport) gets
 * every frame silently dropped by this gate and its request never appears in
 * `received`.
 */
function startFakeHerdr(): Promise<FakeHerdr> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-sock-"));
	const socketPath = path.join(dir, "herdr.sock");
	const received: FakeHerdr["received"] = [];
	const pingOrders: number[] = [];
	const sockets = new Set<net.Socket>();
	let order = 0;
	let handshakeDone = false;
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
				if (line.trim()) {
					const request = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
					if (request.method === "ping") {
						handshakeDone = true;
						pingOrders.push(order++);
						sock.end(
							`${JSON.stringify({ id: request.id, result: { type: "pong", protocol: 18, version: "test" } })}\n`,
						);
					} else if (handshakeDone) {
						received.push({ ...request, order: order++ });
						sock.end(`${JSON.stringify({ id: request.id, result: {} })}\n`);
					} else {
						// Protocol-18 gate: no ping yet, so the method is refused and never recorded.
						sock.end(
							`${JSON.stringify({ id: request.id, error: { message: "protocol handshake required", code: "handshake_required" } })}\n`,
						);
					}
				}
				nl = buf.indexOf("\n");
			}
		});
	});
	return new Promise(resolve => {
		server.listen(socketPath, () => {
			resolve({
				socketPath,
				received,
				pingOrders,
				// Destroy any still-open client sockets so server.close() completes.
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

// HerdrClient generates a fresh random id per request, so assertions compare
// method/params rather than the full frame.
const reportParams = (state: string, seq: number, message?: string) => ({
	pane_id: "w1:p1",
	source: "herdr:xcsh",
	agent: "xcsh",
	state,
	seq,
	...(message === undefined ? {} : { message }),
});

const metadataParams = (
	seq: number,
	options: {
		stateLabels?: Record<string, string>;
		clearStateLabels?: boolean;
		ttlMs?: number;
	},
) => ({
	pane_id: "w1:p1",
	source: "xcsh:phase",
	applies_to_source: "herdr:xcsh",
	seq,
	...(options.stateLabels ? { state_labels: options.stateLabels } : {}),
	...(options.clearStateLabels ? { clear_state_labels: true } : {}),
	...(options.ttlMs !== undefined ? { ttl_ms: options.ttlMs } : {}),
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
			expect(herdr.received[0]?.method).toBe("pane.report_agent");
			expect(herdr.received[0]?.params).toEqual(reportParams("idle", base));
			expect(herdr.received[1]?.method).toBe("pane.report_agent");
			expect(herdr.received[1]?.params).toEqual(reportParams("working", base + 1));
			expect(herdr.received[2]?.method).toBe("pane.report_agent");
			expect(herdr.received[2]?.params).toEqual(reportParams("idle", base + 2));
			// The protocol-18 handshake (ping) must precede every report frame — the
			// fake server's gate refuses to record report/release methods until a
			// ping has been observed, so any recorded frame is proof the handshake
			// already happened.
			expect(herdr.pingOrders.length).toBeGreaterThanOrEqual(1);
			expect(herdr.received[0]!.order).toBeGreaterThan(herdr.pingOrders[0]!);
			// Socket transport must not shell out to the CLI.
			expect(execCalls).toEqual([]);
		} finally {
			await herdr.close();
		}
	});

	it("reconciles a settled completed turn to idle without treating an active turn as idle", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			await handlers.get("agent_start")?.({}, idleCtx);
			handlers.get("turn_end")?.({ turnIndex: 0, message: {}, toolResults: [] }, busyCtx);
			await new Promise(resolve => setTimeout(resolve, 35));
			expect(herdr.received).toHaveLength(1);

			handlers.get("turn_end")?.({ turnIndex: 1, message: {}, toolResults: [] }, idleCtx);
			await waitFor(() => herdr.received.length >= 2);
			const base = baseSeq(herdr);
			expect(herdr.received[1]?.method).toBe("pane.report_agent");
			expect(herdr.received[1]?.params).toEqual(reportParams("idle", base + 1));
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

			const privateSentinels = {
				kind: "select",
				title: "PRIVATE_PROMPT_TITLE",
				question: "PRIVATE_PROMPT_QUESTION",
				options: ["PRIVATE_PROMPT_OPTION"],
				placeholder: "PRIVATE_PROMPT_PLACEHOLDER",
				credential: "PRIVATE_CREDENTIAL_SENTINEL",
			};
			await handlers.get("user_prompt_start")?.(privateSentinels, busyCtx);
			await handlers.get("agent_end")?.({ messages: [] }, busyCtx);
			await handlers.get("user_prompt_end")?.({ kind: "select" }, busyCtx);

			await waitFor(() => herdr.received.filter(frame => frame.method === "pane.report_agent").length >= 3);
			const agentFrames = herdr.received.filter(frame => frame.method === "pane.report_agent");
			const base = agentFrames[0]?.params.seq as number;
			expect(agentFrames[0]?.params).toEqual(reportParams("blocked", base, "selection required"));
			expect(agentFrames[1]?.params).toEqual(reportParams("blocked", base + 1, "selection required"));
			expect(agentFrames[2]?.params).toEqual(reportParams("working", base + 2));
			const capturedFrames = JSON.stringify(herdr.received);
			for (const sentinel of [
				privateSentinels.title,
				privateSentinels.question,
				privateSentinels.options[0],
				privateSentinels.placeholder,
				privateSentinels.credential,
			]) {
				expect(capturedFrames).not.toContain(sentinel);
			}
		} finally {
			await herdr.close();
		}
	});

	it("maps only the closed prompt kind to fixed blocked reasons", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);
			for (const kind of ["select", "confirm", "input", "future-kind"]) {
				await handlers.get("user_prompt_start")?.({ kind }, busyCtx);
			}

			await waitFor(() => herdr.received.filter(frame => frame.method === "pane.report_agent").length >= 4);
			const agentFrames = herdr.received.filter(frame => frame.method === "pane.report_agent");
			const base = agentFrames[0]?.params.seq as number;
			expect(agentFrames.map(frame => frame.params)).toEqual([
				reportParams("blocked", base, "selection required"),
				reportParams("blocked", base + 1, "confirmation required"),
				reportParams("blocked", base + 2, "text input required"),
				reportParams("blocked", base + 3, "user input required"),
			]);
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
			expect(herdr.received[0]?.method).toBe("pane.release_agent");
			expect(herdr.received[0]?.params).toEqual({
				pane_id: "w1:p1",
				source: "herdr:xcsh",
				agent: "xcsh",
				seq: baseSeq(herdr),
			});
			// The release frame must also be preceded by the protocol-18 handshake.
			expect(herdr.pingOrders.length).toBeGreaterThanOrEqual(1);
			expect(herdr.received[0]!.order).toBeGreaterThan(herdr.pingOrders[0]!);
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
		await handlers.get("user_prompt_start")?.({ kind: "confirm" }, busyCtx);
		await handlers.get("user_prompt_end")?.({ kind: "confirm" }, idleCtx);
		await handlers.get("session_shutdown")?.({}, idleCtx);
		await waitFor(() => execCalls.length >= 4);

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
				"report-agent",
				"w1:p1",
				"--source",
				"herdr:xcsh",
				"--agent",
				"xcsh",
				"--state",
				"blocked",
				"--message",
				"confirmation required",
				"--seq",
				String(base + 1),
			],
		});
		expect(execCalls[2]).toEqual({
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
				"idle",
				"--seq",
				String(base + 2),
			],
		});
		expect(execCalls[3]).toEqual({
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
				String(base + 3),
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
				session_start_source: "startup",
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
			expect(session?.params.session_start_source).toBe("startup");
		} finally {
			await herdr.close();
		}
	});

	it("marks only the first session reference as startup", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			let file = "/tmp/x/first-session.jsonl";
			const changingCtx = {
				isIdle: () => true,
				sessionManager: { getSessionFile: () => file, getSessionId: () => "" },
			} as unknown as ExtensionContext;

			herdrReporter(pi);
			await handlers.get("session_start")?.({}, changingCtx);
			file = "/tmp/x/second-session.jsonl";
			await handlers.get("agent_start")?.({}, changingCtx);

			await waitFor(() => herdr.received.filter(r => r.method === "pane.report_agent_session").length === 2);
			const sessions = herdr.received.filter(r => r.method === "pane.report_agent_session");
			expect(sessions[0]?.params.session_start_source).toBe("startup");
			expect(sessions[1]?.params.session_start_source).toBeUndefined();
		} finally {
			await herdr.close();
		}
	});

	it("reports transient phase-label metadata via pane.report_metadata with separate source and sequence", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);

			// 1. thinking phase
			await handlers.get("message_update")?.(
				{
					type: "message_update",
					message: {} as never,
					assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} as never },
				},
				busyCtx,
			);
			await handlers.get("message_update")?.(
				{
					type: "message_update",
					message: {} as never,
					assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "done", partial: {} as never },
				},
				busyCtx,
			);

			// 2. tool phase
			await handlers.get("tool_execution_start")?.(
				{ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: {} },
				busyCtx,
			);
			await handlers.get("tool_execution_end")?.(
				{ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: {}, isError: false },
				busyCtx,
			);

			// 3. retry phase
			await handlers.get("auto_retry_start")?.(
				{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: "network error" },
				busyCtx,
			);
			await handlers.get("auto_retry_end")?.({ type: "auto_retry_end", success: true, attempt: 1 }, busyCtx);

			// 4. cleanup phase
			await handlers.get("auto_compaction_start")?.(
				{ type: "auto_compaction_start", reason: "threshold", action: "context-full" },
				busyCtx,
			);
			await handlers.get("auto_compaction_end")?.(
				{
					type: "auto_compaction_end",
					action: "context-full",
					result: undefined,
					aborted: false,
					willRetry: false,
				},
				busyCtx,
			);

			await waitFor(() => herdr.received.filter(r => r.method === "pane.report_metadata").length >= 8);
			const metadataFrames = herdr.received.filter(r => r.method === "pane.report_metadata");
			const base = metadataFrames[0]?.params.seq as number;
			expect(base).toBeGreaterThan(0);

			// 1. thinking
			expect(metadataFrames[0]?.params).toEqual(
				metadataParams(base, { stateLabels: { working: "thinking" }, ttlMs: 60_000 }),
			);
			expect(metadataFrames[1]?.params).toEqual(metadataParams(base + 1, { clearStateLabels: true }));

			// 2. tool
			expect(metadataFrames[2]?.params).toEqual(
				metadataParams(base + 2, { stateLabels: { working: "tool" }, ttlMs: 60_000 }),
			);
			expect(metadataFrames[3]?.params).toEqual(metadataParams(base + 3, { clearStateLabels: true }));

			// 3. retry
			expect(metadataFrames[4]?.params).toEqual(
				metadataParams(base + 4, { stateLabels: { working: "retry" }, ttlMs: 60_000 }),
			);
			expect(metadataFrames[5]?.params).toEqual(metadataParams(base + 5, { clearStateLabels: true }));

			// 4. cleanup
			expect(metadataFrames[6]?.params).toEqual(
				metadataParams(base + 6, { stateLabels: { working: "cleanup" }, ttlMs: 60_000 }),
			);
			expect(metadataFrames[7]?.params).toEqual(metadataParams(base + 7, { clearStateLabels: true }));

			// Ensure none of the metadata frames used herdr:xcsh source or pane.report_agent
			for (const frame of metadataFrames) {
				expect(frame.params.source).toBe("xcsh:phase");
				expect(frame.params.applies_to_source).toBe("herdr:xcsh");
			}
		} finally {
			await herdr.close();
		}
	});

	it("preserves independent sequences for lifecycle reports and phase metadata", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);

			await handlers.get("session_start")?.({}, idleCtx);
			await handlers.get("agent_start")?.({}, busyCtx);
			await handlers.get("tool_execution_start")?.(
				{ type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: {} },
				busyCtx,
			);
			await handlers.get("tool_execution_end")?.(
				{ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: {}, isError: false },
				busyCtx,
			);
			await handlers.get("agent_end")?.({ messages: [] }, idleCtx);

			await waitFor(() => herdr.received.length >= 5);
			const agentFrames = herdr.received.filter(r => r.method === "pane.report_agent");
			const metadataFrames = herdr.received.filter(r => r.method === "pane.report_metadata");

			expect(agentFrames).toHaveLength(3); // idle, working, idle
			expect(metadataFrames).toHaveLength(2); // tool, clear

			const agentBase = agentFrames[0]?.params.seq as number;
			expect(agentFrames[0]?.params).toEqual(reportParams("idle", agentBase));
			expect(agentFrames[1]?.params).toEqual(reportParams("working", agentBase + 1));
			expect(agentFrames[2]?.params).toEqual(reportParams("idle", agentBase + 2));

			const metaBase = metadataFrames[0]?.params.seq as number;
			expect(metadataFrames[0]?.params).toEqual(
				metadataParams(metaBase, { stateLabels: { working: "tool" }, ttlMs: 60_000 }),
			);
			expect(metadataFrames[1]?.params).toEqual(metadataParams(metaBase + 1, { clearStateLabels: true }));
		} finally {
			await herdr.close();
		}
	});

	it("clears working phase label when user prompt starts and restores it on prompt resolution", async () => {
		const herdr = await startFakeHerdr();
		try {
			process.env.HERDR_PANE_ID = "w1:p1";
			process.env.HERDR_SOCKET_PATH = herdr.socketPath;
			const { pi, handlers } = makeMockPi();

			herdrReporter(pi);

			// 1. Tool execution begins
			await handlers.get("tool_execution_start")?.(
				{ type: "tool_execution_start", toolCallId: "call-1", toolName: "ask", args: {} },
				busyCtx,
			);

			// 2. Interactive prompt opens (e.g. ask tool awaiting user choice)
			await handlers.get("user_prompt_start")?.({ kind: "select" }, busyCtx);

			// 3. User responds to prompt
			await handlers.get("user_prompt_end")?.({ kind: "select" }, busyCtx);

			// 4. Tool execution finishes
			await handlers.get("tool_execution_end")?.(
				{ type: "tool_execution_end", toolCallId: "call-1", toolName: "ask", result: {}, isError: false },
				busyCtx,
			);

			await waitFor(() => herdr.received.filter(r => r.method === "pane.report_metadata").length >= 4);
			const metadataFrames = herdr.received.filter(r => r.method === "pane.report_metadata");
			const base = metadataFrames[0]?.params.seq as number;

			// Frame 0: tool start -> sets working = "tool"
			expect(metadataFrames[0]?.params).toEqual(
				metadataParams(base, { stateLabels: { working: "tool" }, ttlMs: 60_000 }),
			);
			// Frame 1: prompt start -> clears state labels
			expect(metadataFrames[1]?.params).toEqual(metadataParams(base + 1, { clearStateLabels: true }));
			// Frame 2: prompt end -> restores working = "tool"
			expect(metadataFrames[2]?.params).toEqual(
				metadataParams(base + 2, { stateLabels: { working: "tool" }, ttlMs: 60_000 }),
			);
			// Frame 3: tool end -> clears state labels
			expect(metadataFrames[3]?.params).toEqual(metadataParams(base + 3, { clearStateLabels: true }));
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
