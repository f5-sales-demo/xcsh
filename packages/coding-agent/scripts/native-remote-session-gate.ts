/** Opt-in typed-turn probe against the two explicitly prepared acceptance TUIs. */
import assert from "node:assert/strict";
import { remoteSocketPath } from "../src/remote-control/bridge";
import { connectPeer } from "../src/remote-control/ipc";

async function main(): Promise<void> {
	if (process.argv.slice(2).join(" ") !== "--run") {
		process.stdout.write(
			"Usage: bun packages/coding-agent/scripts/native-remote-session-gate.ts --run\nRequires the xcsh Remote Luna and xcsh Remote Astra fixture TUIs.\n",
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
		for (const [name, marker] of [
			["xcsh Remote Luna", "ALPHA-ORCHARD"],
			["xcsh Remote Astra", "BETA-HARBOR"],
		]) {
			const thread = (
				data as { id: string; name: string; model: string; cwd: string; reasoningEffort?: string | null }[]
			).find(value => value.name === name);
			assert(thread, "Fixture terminal missing");
			const read = () =>
				call("thread/read", { threadId: thread.id, includeTurns: true }) as Promise<{
					thread: { turns: { items: { type: string; text?: string }[] }[] };
				}>;
			const before = (await read()).thread.turns.length;
			const params = {
				clientUserMessageId: `fixture-${crypto.randomUUID()}`,
				model: thread.model,
				cwd: thread.cwd,
				effort: thread.reasoningEffort ?? null,
				summary: "auto",
				threadId: thread.id,
				input: [{ type: "text", text: "Reply with only this session's marker, without tools or commentary." }],
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
			assert(matched, "Fixture context round trip failed");
			process.stdout.write(
				`${JSON.stringify({ stage: "local-session", fixture: name, model: thread.model, contextMatched: true, duplicatePromptSuppressed: true, elapsedMs: Date.now() - started })}\n`,
			);
		}
	} finally {
		peer.close();
	}
}
if (import.meta.main)
	main().catch(() => {
		process.stderr.write("Native session gate failed; diagnostics withheld\n");
		process.exitCode = 1;
	});
