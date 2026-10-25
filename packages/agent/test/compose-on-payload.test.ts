/**
 * `composeOnPayload` — the per-turn provider-payload seam that backs server-tool
 * injection (e.g. the Office "Search the web" toggle). Must be a true no-op on the
 * default path so the CLI and every other session are unaffected.
 */
import { describe, expect, it } from "bun:test";
import { composeOnPayload } from "@f5-sales-demo/pi-agent-core";

describe("composeOnPayload", () => {
	it("returns undefined (no-op) when there's neither a base hook nor server tools", () => {
		expect(composeOnPayload(undefined, undefined)).toBeUndefined();
		expect(composeOnPayload(undefined, [])).toBeUndefined();
	});

	it("appends server tools to the request tools when provided", async () => {
		const fn = composeOnPayload(undefined, [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
		expect(fn).toBeDefined();
		const out = (await fn?.({ tools: [{ name: "read" }] })) as { tools: unknown[] };
		expect(out.tools).toEqual([{ name: "read" }, { type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
	});

	it("initializes tools when the payload has none", async () => {
		const fn = composeOnPayload(undefined, [{ type: "web_search_20250305", name: "web_search" }]);
		const out = (await fn?.({})) as { tools: unknown[] };
		expect(out.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
	});

	it("runs the base hook FIRST, then appends server tools to its result", async () => {
		const base = (p: unknown) => ({ ...(p as object), baseRan: true, tools: [{ name: "fromBase" }] });
		const fn = composeOnPayload(base, [{ type: "web_search_20250305", name: "web_search" }]);
		const out = (await fn?.({ tools: [{ name: "orig" }] })) as { tools: unknown[]; baseRan: boolean };
		expect(out.baseRan).toBe(true);
		// The base replaced tools; server tools append to the base's result, not the original.
		expect(out.tools).toEqual([{ name: "fromBase" }, { type: "web_search_20250305", name: "web_search" }]);
	});

	it("delegates to the base hook unchanged when there are no server tools", async () => {
		const base = (p: unknown) => ({ ...(p as object), baseRan: true });
		const fn = composeOnPayload(base, undefined);
		const out = (await fn?.({ tools: [{ name: "read" }] })) as { tools: unknown[]; baseRan: boolean };
		expect(out.baseRan).toBe(true);
		expect(out.tools).toEqual([{ name: "read" }]); // untouched
	});

	it("runs the numeric profiler last, after extension transforms and server-tool injection", async () => {
		const seen: unknown[] = [];
		const base = () => ({ tools: [{ name: "fromBase" }], transformed: true });
		const final = (payload: unknown) => {
			seen.push(structuredClone(payload));
		};
		const fn = composeOnPayload(base, [{ name: "serverTool" }], final);
		const out = await fn?.({ tools: [{ name: "original" }] });

		expect(seen).toEqual([out]);
		expect(seen).toEqual([{ tools: [{ name: "fromBase" }, { name: "serverTool" }], transformed: true }]);
	});

	it("applies a JSON schema to only the requested Responses API payload", async () => {
		const outputSchema = {
			type: "object",
			properties: { title: { type: "string" } },
			required: ["title"],
			additionalProperties: false,
		};
		const withSchema = composeOnPayload(undefined, undefined, undefined, outputSchema, "openai-codex-responses");
		const constrained = (await withSchema?.({ text: { verbosity: "low" } })) as Record<string, any>;
		expect(constrained).toEqual({
			text: {
				verbosity: "low",
				format: { type: "json_schema", name: "xcsh_turn_output", strict: true, schema: outputSchema },
			},
		});

		const nextTurn = composeOnPayload(undefined, undefined);
		expect(nextTurn).toBeUndefined();
	});

	it("uses the Chat Completions response_format envelope", async () => {
		const outputSchema = { type: "object", properties: {}, additionalProperties: false };
		const withSchema = composeOnPayload(undefined, undefined, undefined, outputSchema, "openai-completions");
		expect(await withSchema?.({})).toEqual({
			response_format: {
				type: "json_schema",
				json_schema: { name: "xcsh_turn_output", strict: true, schema: outputSchema },
			},
		});
	});

	it("rejects output schemas synchronously for unsupported provider APIs", () => {
		expect(() => composeOnPayload(undefined, undefined, undefined, {}, "anthropic-messages")).toThrow(
			"Output schemas are not supported by provider API anthropic-messages",
		);
	});
});
