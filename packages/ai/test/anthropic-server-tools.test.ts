/**
 * Anthropic SERVER-SIDE tool blocks (issue #2340).
 *
 * A web-search turn streams `server_tool_use` + `web_search_tool_result` content blocks and
 * `citations_delta` deltas. The provider used to have no branch for any of them, so all three
 * silently vanished: the Office pane showed a bare "Thinking…" for ~6s with no activity row,
 * and Sources chips had to be regex-scraped out of the answer prose.
 *
 * The contract asserted here:
 *  1. Server-tool use surfaces as transient `server_tool_start` / `server_tool_end` events
 *     (with the search query and the result count) so hosts can render live activity.
 *  2. Those blocks NEVER enter `AssistantMessage.content`. They are not executable and must not
 *     look like a `toolCall` (the agent loop would try to run "web_search" and fail), and keeping
 *     them out of history keeps `encrypted_content` / `encrypted_index` from being echoed back
 *     malformed on a follow-up turn (Anthropic 400s on that).
 *  3. `citations_delta` lands as STRUCTURED citations on the text block it annotates.
 */
import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessageEvent, Context, Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

const context: Context = {
	messages: [{ role: "user", content: "latest F5 NGINX Plus release?", timestamp: Date.now() }],
};

type MockAnthropicEvent = Record<string, unknown>;

function createMockRequest(events: MockAnthropicEvent[]) {
	const response = new Response(null, { status: 200, headers: { "request-id": "req_mock" } });
	return {
		async withResponse() {
			return {
				data: {
					async *[Symbol.asyncIterator]() {
						for (const event of events) yield event;
					},
				},
				response,
				request_id: response.headers.get("request-id"),
			};
		},
	};
}

const QUERY = "latest F5 NGINX Plus release";
const ANSWER = "NGINX Plus R34 is the latest release.";
const RESULT_A = {
	type: "web_search_result",
	url: "https://docs.nginx.com/nginx/releases/",
	title: "NGINX Plus Releases",
	encrypted_content: "ENCRYPTED_A",
	page_age: "2 days ago",
};
const RESULT_B = {
	type: "web_search_result",
	url: "https://www.f5.com/products/nginx",
	title: "F5 NGINX",
	encrypted_content: "ENCRYPTED_B",
	page_age: null,
};

function messageStart(): MockAnthropicEvent {
	return {
		type: "message_start",
		message: {
			id: "msg_websearch",
			usage: { input_tokens: 20, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		},
	};
}

function messageEnd(): MockAnthropicEvent[] {
	return [
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { input_tokens: 20, output_tokens: 9, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
		},
		{ type: "message_stop" },
	];
}

/** A realistic successful web-search turn: search → results → cited answer. */
function webSearchEvents(): MockAnthropicEvent[] {
	return [
		messageStart(),
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
		},
		{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"' } },
		{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: `${QUERY}"}` } },
		{ type: "content_block_stop", index: 0 },
		{
			type: "content_block_start",
			index: 1,
			content_block: {
				type: "web_search_tool_result",
				tool_use_id: "srvtoolu_1",
				content: [RESULT_A, RESULT_B],
			},
		},
		{ type: "content_block_stop", index: 1 },
		{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: ANSWER } },
		{
			type: "content_block_delta",
			index: 2,
			delta: {
				type: "citations_delta",
				citation: {
					type: "web_search_result_location",
					url: RESULT_A.url,
					title: RESULT_A.title,
					cited_text: "R34 is the latest",
					encrypted_index: "IDX_A",
				},
			},
		},
		{ type: "content_block_stop", index: 2 },
		...messageEnd(),
	];
}

/** A web-search turn that Anthropic rejects (quota). */
function webSearchErrorEvents(): MockAnthropicEvent[] {
	return [
		messageStart(),
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: `{"query":"${QUERY}"}` },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "content_block_start",
			index: 1,
			content_block: {
				type: "web_search_tool_result",
				tool_use_id: "srvtoolu_1",
				content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
			},
		},
		{ type: "content_block_stop", index: 1 },
		...messageEnd(),
	];
}

async function collect(events: MockAnthropicEvent[]) {
	vi.spyOn(Messages.prototype, "create").mockImplementation(() => createMockRequest(events) as never);
	const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
	const seen: AssistantMessageEvent[] = [];
	for await (const event of stream) seen.push(event);
	return { events: seen, result: await stream.result() };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("anthropic server-side tool blocks (#2340)", () => {
	it("emits server_tool_start carrying the search query", async () => {
		const { events } = await collect(webSearchEvents());

		const starts = events.filter(e => e.type === "server_tool_start");
		expect(starts).toHaveLength(1);
		expect(starts[0]).toMatchObject({ toolName: "web_search", toolId: "srvtoolu_1", query: QUERY });
	});

	it("emits server_tool_end carrying the result count", async () => {
		const { events } = await collect(webSearchEvents());

		const ends = events.filter(e => e.type === "server_tool_end");
		expect(ends).toHaveLength(1);
		expect(ends[0]).toMatchObject({ toolName: "web_search", toolId: "srvtoolu_1", resultCount: 2 });
		expect((ends[0] as { errorCode?: string }).errorCode).toBeUndefined();
	});

	it("orders server_tool_start before server_tool_end before the answer text", async () => {
		const { events } = await collect(webSearchEvents());
		const order = events.map(e => e.type);

		expect(order.indexOf("server_tool_start")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("server_tool_start")).toBeLessThan(order.indexOf("server_tool_end"));
		expect(order.indexOf("server_tool_end")).toBeLessThan(order.indexOf("text_delta"));
	});

	it("NEVER models server tools as an executable toolCall", async () => {
		const { events, result } = await collect(webSearchEvents());

		expect(events.some(e => e.type === "toolcall_start")).toBe(false);
		expect(events.some(e => e.type === "toolcall_end")).toBe(false);
		expect(result.content.some(block => block.type === "toolCall")).toBe(false);
	});

	it("keeps server-tool blocks OUT of message content (no encrypted_* echoed on follow-up)", async () => {
		const { result } = await collect(webSearchEvents());

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(JSON.stringify(result.content)).not.toContain("ENCRYPTED_A");
		expect(JSON.stringify(result.content)).not.toContain("ENCRYPTED_B");
	});

	it("attaches structured citations to the text block they annotate", async () => {
		const { result } = await collect(webSearchEvents());

		const text = result.content[0];
		expect(text.type).toBe("text");
		if (text.type !== "text") throw new Error("expected a text block");
		expect(text.text).toBe(ANSWER);
		expect(text.citations).toHaveLength(1);
		expect(text.citations?.[0]).toEqual({
			type: "web_search_result_location",
			url: RESULT_A.url,
			title: RESULT_A.title,
			citedText: "R34 is the latest",
			encryptedIndex: "IDX_A",
		});
	});

	it("still streams the answer text normally around the server-tool blocks", async () => {
		const { events, result } = await collect(webSearchEvents());

		expect(events.filter(e => e.type === "text_start")).toHaveLength(1);
		expect(events.filter(e => e.type === "text_end")).toHaveLength(1);
		expect(events.filter(e => e.type === "done")).toHaveLength(1);
		expect(result.stopReason).toBe("stop");
	});

	it("reports a server-tool failure via errorCode instead of a result count", async () => {
		const { events } = await collect(webSearchErrorEvents());

		const ends = events.filter(e => e.type === "server_tool_end");
		expect(ends).toHaveLength(1);
		expect(ends[0]).toMatchObject({ toolName: "web_search", errorCode: "max_uses_exceeded" });
		expect((ends[0] as { resultCount?: number }).resultCount).toBeUndefined();
	});

	it("leaves a plain turn with no server tools completely unchanged", async () => {
		const { events, result } = await collect([
			messageStart(),
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
			{ type: "content_block_stop", index: 0 },
			...messageEnd(),
		]);

		expect(events.some(e => e.type === "server_tool_start" || e.type === "server_tool_end")).toBe(false);
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("reads the query from an INLINE input when it is not streamed as deltas", async () => {
		// Nothing obliges a provider to stream a server tool's input incrementally — it may
		// arrive whole on content_block_start. The activity row must still name the search.
		const { events } = await collect([
			messageStart(),
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: QUERY } },
			},
			{ type: "content_block_stop", index: 0 },
			...messageEnd(),
		]);

		const starts = events.filter(e => e.type === "server_tool_start");
		expect(starts).toHaveLength(1);
		expect(starts[0]).toMatchObject({ toolName: "web_search", query: QUERY });
	});

	it("still announces the search when no query is available at all", async () => {
		const { events } = await collect([
			messageStart(),
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
			},
			{ type: "content_block_stop", index: 0 },
			...messageEnd(),
		]);

		const starts = events.filter(e => e.type === "server_tool_start");
		expect(starts).toHaveLength(1);
		expect(starts[0]).toMatchObject({ toolName: "web_search", toolId: "srvtoolu_1" });
		expect((starts[0] as { query?: string }).query).toBeUndefined();
	});
});
