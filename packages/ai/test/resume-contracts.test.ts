import { describe, expect, it } from "bun:test";
import { Type } from "@sinclair/typebox";
import { fetchDeferred, requestDeferred } from "../src/deferred";
import { getBundledModel } from "../src/models";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import { validateFinalResponsesRequest } from "../src/providers/sol-request-boundary";
import type { Model } from "../src/types";

const model = getBundledModel("openai", "gpt-6.1-sol");
const handle = {
	provider: model.provider,
	modelId: model.id,
	api: model.api,
	baseUrl: model.baseUrl,
	id: "resp_synthetic",
};

describe("resumed provider contract acceptance", () => {
	it("reconstructs deferred text, encrypted reasoning and tool correlation", async () => {
		const result = await fetchDeferred(model, handle, {
			apiKey: "synthetic",
			fetch: async () =>
				Response.json({
					id: handle.id,
					status: "completed",
					model: model.id,
					output: [
						{ type: "reasoning", id: "rs_synthetic", summary: [], encrypted_content: "synthetic-encrypted" },
						{
							type: "message",
							id: "msg_synthetic",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "done", annotations: [] }],
						},
						{
							type: "function_call",
							id: "fc_synthetic",
							call_id: "call_synthetic",
							name: "read",
							arguments: '{"path":"synthetic.txt"}',
						},
					],
					usage: {
						input_tokens: 100,
						output_tokens: 20,
						total_tokens: 120,
						input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
					},
				}),
		});
		expect(result).toMatchObject({
			role: "assistant",
			responseId: handle.id,
			stopReason: "toolUse",
			usage: { input: 60, cacheRead: 30, cacheWrite: 10, output: 20 },
		});
		expect(result.content).toMatchObject([
			{ type: "thinking", thinkingSignature: expect.stringContaining("synthetic-encrypted") },
			{ type: "text", text: "done" },
			{ type: "toolCall", id: "call_synthetic|fc_synthetic", arguments: { path: "synthetic.txt" } },
		]);
	});
	it("keeps queued work pollable and rejects mismatched or malformed completion", async () => {
		const options = {
			apiKey: "synthetic",
			fetch: async () => Response.json({ id: handle.id, status: "queued", output: [] }),
		};
		expect(await fetchDeferred(model, handle, options)).toMatchObject({ role: "assistant", deferred: handle });
		await expect(
			fetchDeferred(model, handle, {
				...options,
				fetch: async () => Response.json({ id: "other", status: "completed", output: [] }),
			}),
		).rejects.toThrow("identity");
		await expect(
			fetchDeferred(model, handle, {
				...options,
				fetch: async () => Response.json({ id: handle.id, status: "completed", output: {} }),
			}),
		).rejects.toThrow("Malformed");
	});
	it("rejects operation mismatch before creating deferred work", async () => {
		await expect(
			requestDeferred({ ...model, type: "image" } as unknown as Model, { messages: [] }, { apiKey: "synthetic" }),
		).rejects.toThrow("chat");
	});
	it("strips subscription restrictions after hooks on every Codex model", () => {
		const codex = getBundledModel("openai-codex", "gpt-6.1-sol");
		for (const candidate of [codex, { ...codex, id: "gpt-6-sol" }]) {
			const body: any = {
				store: true,
				stream: false,
				temperature: 1,
				max_output_tokens: 10,
				prompt_cache_options: { mode: "explicit" },
				prompt_cache_retention: "30m",
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "synthetic", prompt_cache_breakpoint: { mode: "explicit" } }],
					},
				],
			};
			validateFinalResponsesRequest(candidate, body);
			expect(body.store).toBe(false);
			expect(body.stream).toBe(true);
			for (const field of ["temperature", "max_output_tokens", "prompt_cache_options", "prompt_cache_retention"])
				expect(body).not.toHaveProperty(field);
			expect(body.input[0].content[0]).not.toHaveProperty("prompt_cache_breakpoint");
		}
	});
	it("removes unsupported API cache markers while preserving explicit-capable routes", () => {
		const input = () => [
			{
				role: "user",
				content: [{ type: "input_text", text: "synthetic", prompt_cache_breakpoint: { mode: "explicit" } }],
			},
		];
		const unsupported: any = { input: input(), prompt_cache_options: { mode: "explicit" } };
		validateFinalResponsesRequest({ ...model, compat: {} }, unsupported);
		expect(unsupported).not.toHaveProperty("prompt_cache_options");
		expect(unsupported.input[0].content[0]).not.toHaveProperty("prompt_cache_breakpoint");
		const supported: any = { input: input(), prompt_cache_options: { mode: "explicit" } };
		validateFinalResponsesRequest({ ...model, compat: { supportsExplicitPromptCacheMode: true } }, supported);
		expect(supported.input[0].content[0]).toHaveProperty("prompt_cache_breakpoint");
	});
	it("dispatches client tool search once and round-trips its native correlation", async () => {
		const item = {
			type: "tool_search_call",
			execution: "client",
			id: "ts_synthetic",
			call_id: "call_search",
			status: "completed",
			arguments: { query: "read", limit: 1 },
		};
		const events = [
			{ type: "response.output_item.added", output_index: 0, item },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: handle.id, status: "completed", output: [item] } },
		];
		const assistant = await streamOpenAIResponses(
			model as Model<"openai-responses">,
			{ messages: [] },
			{
				apiKey: "synthetic",
				fetch: async () =>
					new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
						headers: { "Content-Type": "text/event-stream" },
					}),
			},
		).result();
		expect(assistant.stopReason).toBe("toolUse");
		expect(assistant.content).toMatchObject([
			{
				type: "toolCall",
				name: "search_tool_bm25",
				toolSearch: true,
				id: "call_search|ts_synthetic",
				arguments: item.arguments,
			},
		]);
		let body: any;
		await streamOpenAIResponses(
			model as Model<"openai-responses">,
			{
				messages: [
					assistant,
					{
						role: "toolResult",
						toolCallId: "call_search|ts_synthetic",
						toolName: "search_tool_bm25",
						toolSearch: true,
						tools: [{ name: "read", description: "Read", parameters: Type.Object({}) }],
						content: [{ type: "text", text: "loaded" }],
						isError: false,
						timestamp: 1,
					},
				],
			},
			{
				apiKey: "synthetic",
				signal: AbortSignal.abort(),
				onPayload: value => {
					body = value;
				},
			},
		).result();
		expect(body.input.filter((value: any) => value.type === "tool_search_call")).toHaveLength(1);
		expect(body.input.at(-1)).toMatchObject({
			type: "tool_search_output",
			call_id: "call_search",
			execution: "client",
			tools: [{ name: "read", defer_loading: true }],
		});
	});
});
