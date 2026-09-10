import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareProtocolTraces, ProtocolTrace, redactProtocolValue } from "../../src/remote-control/trace";

test("parity capture removes credentials, media, paths, and private text while preserving protocol structure", () => {
	const raw = {
		id: "private-id",
		method: "thread/realtime/start",
		params: {
			accessToken: "private-token",
			authorization: "Bearer private-token",
			transport: { type: "webrtc", sdp: "private-sdp" },
			audio: { data: "private-audio", sampleRate: 24000 },
			cwd: "/private/path",
			initialItems: [{ role: "user", text: "private speech" }],
			includeStartupContext: false,
		},
	};
	const value = redactProtocolValue(raw, "fixture-salt");
	const serialized = JSON.stringify(value);
	for (const secret of [
		"private-token",
		"private-sdp",
		"private-audio",
		"/private/path",
		"private speech",
		"private-id",
	])
		expect(serialized).not.toContain(secret);
	expect(value).toMatchObject({
		method: "thread/realtime/start",
		params: {
			transport: { type: "webrtc" },
			audio: { sampleRate: 24000 },
			initialItems: [{ role: "user" }],
			includeStartupContext: false,
		},
	});
});
test("parity capture preserves identifier equality and missing versus null fields", () => {
	const value: any = redactProtocolValue(
		{ id: "fixture-id", params: { threadId: "fixture-id", cursor: null } },
		"fixture-salt",
	);
	expect(value.id).toEqual(value.params.threadId);
	expect(value.params.cursor).toBeNull();
	expect(value.params).not.toHaveProperty("model");
});

test.each(["realtimeSessionStarted", "transcriptSegment", "realtimeSessionClosed", "bemItemPromoted"])(
	"capture retains canonical realtime item type %s",
	type => {
		expect(redactProtocolValue({ type }, "fixture")).toEqual({ type });
	},
);
test.each(["handoff_request", "userMessage", "agentMessage", "reasoning", "fileChange", "commandExecution"])(
	"capture retains pinned delegation/tool item type %s without retaining private contents",
	type => {
		expect(redactProtocolValue({ type, text: "private fixture data" }, "fixture")).toMatchObject({
			type,
			text: { $redacted: "string" },
		});
	},
);
test("capture retains the delegation routing target but redacts unknown targets", () => {
	expect(redactProtocolValue({ target: "client" }, "fixture")).toEqual({ target: "client" });
	expect(redactProtocolValue({ target: "private workspace" }, "fixture")).toMatchObject({
		target: { $redacted: "string" },
	});
});

test.each(["experimentalFeature/list", "mcpServerStatus/list", "externalAgentConfig/detect"])(
	"capture retains pinned request method %s",
	method => {
		expect(redactProtocolValue({ method }, "fixture")).toEqual({ method });
	},
);

test.each([
	"client_message",
	"client_message_chunk",
	"client_closed",
	"server_message",
	"server_message_chunk",
	"unknown",
])("capture retains the pinned relay signal %s", type => {
	expect(redactProtocolValue({ type }, "fixture")).toEqual({ type });
});
test("parity comparison detects fields, explicit errors, and event order but normalizes opaque identities and timings", () => {
	const record = (source: "codex" | "xcsh", sequence: number, message: unknown) => ({
		source,
		layer: "rpc",
		direction: "out",
		sequence,
		elapsedMs: sequence * 17,
		message: redactProtocolValue(message, source),
	});
	const expected = [
		record("codex", 1, { method: "thread/realtime/started", params: { threadId: "reference", version: "v3" } }),
		record("codex", 2, { id: "reference", result: { status: "unsubscribed" } }),
	];
	const actual = [
		record("xcsh", 1, { method: "thread/realtime/started", params: { threadId: "candidate", version: "v3" } }),
		record("xcsh", 2, { id: "candidate", result: { status: "unsubscribed" } }),
	];
	expect(compareProtocolTraces(expected, actual).differences).toEqual([]);
	expect(compareProtocolTraces(expected, [...actual].reverse()).differences.length).toBeGreaterThan(0);
	expect(
		compareProtocolTraces(expected, [actual[0], record("xcsh", 2, { id: "candidate", result: {} })]).differences
			.length,
	).toBeGreaterThan(0);
	expect(
		compareProtocolTraces(expected, [actual[0], record("xcsh", 2, { id: "candidate", error: { code: -32601 } })])
			.differences.length,
	).toBeGreaterThan(0);
});
test("trace recordings use private files and retain both directions with source and timing provenance", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-parity-"));
	try {
		const file = join(root, "events.jsonl");
		const trace = new ProtocolTrace(file, {
			source: "xcsh",
			version: "fixture-version",
			sourceCommit: "fixture-commit",
			scenario: "typed",
		});
		trace.record("rpc", "in", { id: 1, method: "initialize", params: {} });
		trace.record("rpc", "out", { id: 1, result: { userAgent: "private-machine" } });
		trace.close();
		const rows = (await readFile(file, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(rows[0]).toMatchObject({
			kind: "manifest",
			version: "fixture-version",
			sourceCommit: "fixture-commit",
			scenario: "typed",
		});
		expect(rows.filter(row => row.kind === "event").map(row => [row.layer, row.direction, row.sequence])).toEqual([
			["rpc", "in", 1],
			["rpc", "out", 2],
		]);
		expect(rows.at(-1)).toMatchObject({ kind: "footer", complete: true });
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(JSON.stringify(rows)).not.toContain("private-machine");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("capture overflow is explicit and prevents a complete parity result", () => {
	const record: any = { layer: "rpc", direction: "out", kind: "captureOverflow" };
	const comparison = compareProtocolTraces([record], [record]);
	expect(comparison.complete).toBe(false);
});

test("empty recordings and missing capture boundaries cannot establish parity", () => {
	expect(compareProtocolTraces([], []).complete).toBe(false);
});

test("a missing event cannot be hidden by a valid-looking completion footer", () => {
	const rows = [
		{ kind: "manifest" },
		{ kind: "event", sequence: 2, layer: "rpc", direction: "in", message: { method: "initialized" } },
		{ kind: "footer", complete: true, events: 2 },
	];
	expect(compareProtocolTraces(rows, rows).complete).toBe(false);
});

test("a recorder can explicitly invalidate evidence after a producer loses an event", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-parity-"));
	try {
		const file = join(root, "invalid.jsonl");
		const trace = new ProtocolTrace(file, {
			source: "codex",
			version: "0.153.4",
			sourceCommit: "fixture",
			scenario: "typed",
		});
		trace.invalidate("producer-gap");
		trace.close();
		const rows = (await readFile(file, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(rows.at(-1).complete).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("separate processes can preserve cross-layer identities with an explicit capture salt and clock origin", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-parity-"));
	try {
		const rows = [];
		for (const role of ["host", "voice"]) {
			const file = join(root, `${role}.jsonl`);
			const trace = new ProtocolTrace(
				file,
				{ source: "xcsh", version: "fixture", sourceCommit: "fixture", scenario: "voice" },
				undefined,
				"shared-private-salt",
			);
			trace.record(role, "in", { callId: "same-private-call" });
			trace.close();
			rows.push(
				(await readFile(file, "utf8"))
					.trim()
					.split("\n")
					.map(line => JSON.parse(line)),
			);
		}
		expect(rows[0][1].message.callId).toEqual(rows[1][1].message.callId);
		expect(rows[0][0].startedAtUnixMs).toBeGreaterThan(0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
