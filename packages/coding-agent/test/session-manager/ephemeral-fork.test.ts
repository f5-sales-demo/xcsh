import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../../src/session/session-manager";

test("an in-memory fork preserves exact source history without creating durable state", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-ephemeral-fork-"));
	try {
		const source = SessionManager.create(root, root);
		const first = source.appendMessage({
			role: "user",
			content: [{ type: "text", text: "first" }],
			timestamp: 1,
		});
		source.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "openai-responses",
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			stopReason: "stop",
			timestamp: 2,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		});
		await source.ensureOnDisk();
		await source.flush();

		const fork = await SessionManager.inMemoryForkFrom(source.getSessionFile()!, "/tmp/ephemeral-cwd");
		expect(fork.getSessionId()).not.toBe(source.getSessionId());
		expect(fork.getSessionFile()).toBeUndefined();
		expect(fork.getCwd()).toBe("/tmp/ephemeral-cwd");
		expect(fork.getHeader()).toMatchObject({ parentSession: source.getSessionId() });
		expect(fork.getBranch().map(entry => entry.id)).toEqual(source.getBranch().map(entry => entry.id));
		expect(fork.getLeafId()).toBe(source.getLeafId());
		expect(fork.getEntry(first)).toMatchObject({ id: first });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
