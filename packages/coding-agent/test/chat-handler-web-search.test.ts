/**
 * "Search the web" toggle → `chat_request.web_search` → the handler adds Anthropic's
 * server-side web_search tool to the turn via `PromptOptions.serverTools`. The gateway
 * executes it server-side (verified live); this test asserts the wiring.
 */
import { expect, test } from "bun:test";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession } from "@f5-sales-demo/xcsh/session/agent-session";

function harness() {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	const promptCalls: Array<{ text: string; options?: Record<string, unknown> }> = [];
	const server = {
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		skills: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: () => () => {},
		prompt: async (text: string, options?: Record<string, unknown>) => {
			promptCalls.push({ text, options });
		},
	} as unknown as AgentSession;
	return { server, session, promptCalls, fire: (m: Record<string, unknown>) => onMsg(m) };
}

const flush = (ms = 15) => new Promise(r => setTimeout(r, ms));

test("web_search:true adds the server-side web_search tool to session.prompt serverTools", async () => {
	const h = harness();
	new ChatHandler(h.server, h.session).attach();
	h.fire({
		type: "chat_request",
		id: "c-1",
		text: "latest F5 NGINX version?",
		context: null,
		mode: "educational",
		web_search: true,
	});
	await flush();
	expect(h.promptCalls).toHaveLength(1);
	const serverTools = h.promptCalls[0].options?.serverTools as Array<Record<string, unknown>> | undefined;
	expect(serverTools).toBeDefined();
	expect(serverTools?.[0]).toMatchObject({ type: "web_search_20250305", name: "web_search" });
});

test("without web_search, no serverTools are attached (default turn is unchanged)", async () => {
	const h = harness();
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
	await flush();
	expect(h.promptCalls).toHaveLength(1);
	expect(h.promptCalls[0].options?.serverTools).toBeUndefined();
});
