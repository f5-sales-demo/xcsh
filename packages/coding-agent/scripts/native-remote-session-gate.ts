/** Opt-in typed-turn probe against the two explicitly prepared acceptance TUIs. */
import assert from "node:assert/strict";
import { remoteSocketPath } from "../src/remote-control/bridge";
import { connectPeer } from "../src/remote-control/ipc";

async function main(): Promise<void> {
	if (process.argv.slice(2).join(" ") !== "--run") {
		process.stdout.write(
			"Usage: bun packages/coding-agent/scripts/native-remote-session-gate.ts --run\nRequires one current xcsh interactive terminal.\n",
		);
		return;
	}
	const peer = await connectPeer(remoteSocketPath());
	peer.handle = async method => {
		assert.equal(method, "protocol/event");
		return {};
	};
	let requestId = 0;
	async function call(
		method: string,
		params: Record<string, unknown> = {},
		id: string | number = ++requestId,
	): Promise<Record<string, unknown>> {
		const response = (await peer.call("protocol", { request: { id, method, params } })) as {
			result: Record<string, unknown>;
			error?: { message: string };
		};
		if (response.error) throw new Error("Local protocol probe rejected");
		return response.result;
	}
	try {
		await call("initialize", { clientInfo: { name: "xcsh-native-gate", version: "1" } });
		const { data } = await call("thread/list");
		const threads = data as { id: string; model: string; cwd: string; reasoningEffort?: string | null }[];
		assert.equal(threads.length, 1, "Remote UI must expose one current terminal");
		const thread = threads[0]!;
		const catalog = (await call("model/list")) as { data: { id: string }[] };
		assert(
			catalog.data.some(model => model.id === thread.model),
			"Current terminal model is missing from its catalog",
		);
		const read = () =>
			call("thread/read", { threadId: thread.id, includeTurns: true }) as Promise<{
				thread: { turns: { items: { type: string; text?: string }[] }[] };
			}>;
		const before = (await read()).thread.turns.length;
		const marker = `XCSH-VANILLA-${crypto.randomUUID()}`;
		const params = {
			clientUserMessageId: `vanilla-${crypto.randomUUID()}`,
			model: thread.model,
			cwd: thread.cwd,
			effort: thread.reasoningEffort ?? null,
			summary: "auto",
			threadId: thread.id,
			input: [{ type: "text", text: `Reply with only ${marker}, without tools or commentary.` }],
		};
		const id = `gate-${crypto.randomUUID()}`;
		const started = Date.now();
		await call("skills/extraRoots/set", { extraRoots: [] });
		const result = (await call("turn/start", params, id)) as { turn: { id: string } };
		const replay = (await call("turn/start", params, id)) as { turn: { id: string } };
		assert.equal(replay.turn.id, result.turn.id, "Replay selected another turn");
		const retried = (await call("turn/start", params, `${id}-retry`)) as { turn: { id: string } };
		assert.equal(retried.turn.id, result.turn.id, "Client message retry selected another turn");
		let matched = false;
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			const turns = (await read()).thread.turns;
			if (
				turns.length === before + 1 &&
				turns.at(-1)?.items.some(item => item.type === "agentMessage" && item.text?.trim() === marker)
			) {
				matched = true;
				break;
			}
			await Bun.sleep(250);
		}
		assert(matched, "Vanilla session context round trip failed");
		process.stdout.write(
			`${JSON.stringify({ stage: "local-session", model: thread.model, catalogContainsCurrentModel: true, contextMatched: true, duplicatePromptSuppressed: true, elapsedMs: Date.now() - started })}\n`,
		);
	} finally {
		peer.close();
	}
}
if (import.meta.main)
	main().catch(() => {
		process.stderr.write("Native session gate failed; diagnostics withheld\n");
		process.exitCode = 1;
	});
