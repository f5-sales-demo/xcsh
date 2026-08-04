/** `list_models` exposes the Office-supported models that this xcsh can resolve. */
import { expect, test } from "bun:test";
import { ChatHandler } from "../src/browser/chat-handler";
import { isListModels } from "../src/browser/chat-protocol";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { AgentSession } from "../src/session/agent-session";

function harness(available: Array<{ provider: string; id: string }>, current = available[0]) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	const server = {
		serveKind: "office",
		clientHost: "excel",
		send: (payload: unknown) => sent.push(payload as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		model: current,
		modelRegistry: {
			find: (provider: string, id: string) =>
				available.find(model => model.provider === provider && model.id === id),
		},
		skills: [],
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: () => () => {},
		prompt: async () => {},
	} as unknown as AgentSession;
	return { sent, server, session, fire: (message: Record<string, unknown>) => onMsg(message) };
}

test("isListModels accepts only list_models", () => {
	expect(isListModels({ type: "list_models" })).toBe(true);
	expect(isListModels({ type: "list_skills" })).toBe(false);
});

test("list_models reports the active model and only available curated provider/model pairs", () => {
	const h = harness(
		[
			{ provider: "litellm", id: "gpt-5.6-sol" },
			{ provider: "anthropic", id: "claude-opus-5" },
			{ provider: "other", id: "claude-opus-5" },
		],
		{ provider: "anthropic", id: "claude-opus-5" },
	);
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "list_models" });

	expect(h.sent).toContainEqual({
		type: "models",
		current: "claude-opus-5",
		models: [
			{ id: "claude-opus-5", label: "Claude Opus 5" },
			{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
		],
	});
});
