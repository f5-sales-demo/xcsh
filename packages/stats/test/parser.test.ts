import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getSessionMessageChain } from "../src/parser";

const cleanupRoots: string[] = [];

async function writeSession(entries: unknown[]): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-stats-chain-"));
	cleanupRoots.push(root);
	const sessionPath = path.join(root, "session.jsonl");
	await Bun.write(sessionPath, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
	return sessionPath;
}

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("getSessionMessageChain", () => {
	it("returns ordered message ancestry while traversing non-message entries", async () => {
		const sessionPath = await writeSession([
			{
				type: "message",
				id: "user",
				parentId: null,
				timestamp: "1",
				message: { role: "user", content: "hello", timestamp: 1 },
			},
			{ type: "custom", id: "marker", parentId: "user" },
			{
				type: "message",
				id: "assistant",
				parentId: "marker",
				timestamp: "2",
				message: { role: "assistant", content: [], timestamp: 2 },
			},
		]);

		const chain = await getSessionMessageChain(sessionPath, "assistant");

		expect(chain.map(entry => entry.id)).toEqual(["user", "assistant"]);
	});

	it("returns recovered messages when a parent is missing", async () => {
		const sessionPath = await writeSession([
			{
				type: "message",
				id: "assistant",
				parentId: "missing",
				timestamp: "2",
				message: { role: "assistant", content: [], timestamp: 2 },
			},
		]);

		expect((await getSessionMessageChain(sessionPath, "assistant")).map(entry => entry.id)).toEqual(["assistant"]);
	});

	it("terminates malformed cycles without duplicating messages", async () => {
		const sessionPath = await writeSession([
			{
				type: "message",
				id: "one",
				parentId: "two",
				timestamp: "1",
				message: { role: "user", content: "one", timestamp: 1 },
			},
			{
				type: "message",
				id: "two",
				parentId: "one",
				timestamp: "2",
				message: { role: "assistant", content: [], timestamp: 2 },
			},
		]);

		expect((await getSessionMessageChain(sessionPath, "two")).map(entry => entry.id)).toEqual(["one", "two"]);
	});
});
