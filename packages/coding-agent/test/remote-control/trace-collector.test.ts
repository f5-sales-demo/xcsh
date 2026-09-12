import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTraceCollector } from "../../src/remote-control/trace-collector";

async function send(path: string, text: string) {
	await new Promise<void>((resolve, reject) => {
		const socket = connect(path, () => socket.end(text));
		socket.on("error", reject);
		socket.on("close", () => resolve());
	});
}
test("reference collector redacts before persistence and detects missing producer messages", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-collector-"));
	try {
		const path = join(root, "capture.sock"),
			file = join(root, "capture.jsonl");
		const collector = await startTraceCollector(path, file, {
			source: "codex",
			version: "0.153.4",
			sourceCommit: "fixture",
			scenario: "typed",
		});
		await send(
			path,
			`${JSON.stringify({ producer: "transport", sequence: 1, layer: "rpc", direction: "in", message: { id: 1, method: "turn/start", params: { text: "private utterance" } } })}\n`,
		);
		await send(
			path,
			`${JSON.stringify({ producer: "transport", sequence: 3, layer: "rpc", direction: "out", message: { id: 1, result: {} } })}\n`,
		);
		await collector.close();
		const content = await readFile(file, "utf8");
		expect(content).not.toContain("private utterance");
		const rows = content
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		expect(rows.find(row => row.kind === "event").message.method).toBe("turn/start");
		expect(rows.at(-1).complete).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("reference collector rejects truncated frames without persisting their text", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-collector-"));
	try {
		const path = join(root, "capture.sock"),
			file = join(root, "capture.jsonl");
		const collector = await startTraceCollector(path, file, {
			source: "codex",
			version: "0.153.4",
			sourceCommit: "fixture",
			scenario: "typed",
		});
		await send(path, '{"private":"partial secret');
		await collector.close();
		const content = await readFile(file, "utf8");
		expect(content).not.toContain("partial secret");
		expect(JSON.parse(content.trim().split("\n").at(-1)!).complete).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
