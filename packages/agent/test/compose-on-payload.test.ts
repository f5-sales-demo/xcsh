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
});
