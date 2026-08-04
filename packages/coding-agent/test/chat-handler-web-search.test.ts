/**
 * "Search the web" toggle → `chat_request.web_search` → the handler selects the
 * active model API's native server-side web-search tool. The gateway executes it
 * server-side; these tests prevent a model switch from leaking the previous API's
 * descriptor into the next request.
 */
import { expect, test } from "bun:test";
import { ChatHandler } from "../src/browser/chat-handler";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { AgentSession } from "../src/session/agent-session";

type WebSearchModelApi = "anthropic-messages" | "openai-completions";

function harness(initialModelApi: WebSearchModelApi) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	const promptCalls: Array<{ text: string; options?: Record<string, unknown> }> = [];
	let modelApi = initialModelApi;
	const server = {
		serveKind: "office",
		clientHost: "excel",
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		get model() {
			return { api: modelApi };
		},
		skills: [],
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: () => () => {},
		prompt: async (text: string, options?: Record<string, unknown>) => {
			promptCalls.push({ text, options });
		},
	} as unknown as AgentSession;
	return {
		server,
		session,
		promptCalls,
		fire: (m: Record<string, unknown>) => onMsg(m),
		setModelApi: (api: WebSearchModelApi) => {
			modelApi = api;
		},
	};
}

const flush = (ms = 15) => new Promise(r => setTimeout(r, ms));

test("Anthropic web search uses Anthropic's native server-tool descriptor", async () => {
	const h = harness("anthropic-messages");
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
	expect(serverTools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
});

test("OpenAI-compatible web search uses OpenAI's native descriptor", async () => {
	const h = harness("openai-completions");
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
	expect(serverTools).toEqual([{ type: "web_search_preview" }]);
});

test("switching Anthropic → OpenAI → Anthropic selects each turn from the active model API", async () => {
	const h = harness("anthropic-messages");
	new ChatHandler(h.server, h.session).attach();

	const sendSearch = (id: string): void =>
		h.fire({ type: "chat_request", id, text: "search", context: null, mode: "educational", web_search: true });

	sendSearch("c-1");
	await flush();
	h.setModelApi("openai-completions");
	sendSearch("c-2");
	await flush();
	h.setModelApi("anthropic-messages");
	sendSearch("c-3");
	await flush();

	expect(h.promptCalls.map(call => call.options?.serverTools)).toEqual([
		[{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
		[{ type: "web_search_preview" }],
		[{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
	]);
});

test("without web_search, no serverTools are attached (default turn is unchanged)", async () => {
	const h = harness("openai-completions");
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
	await flush();
	expect(h.promptCalls).toHaveLength(1);
	expect(h.promptCalls[0].options?.serverTools).toBeUndefined();
});
