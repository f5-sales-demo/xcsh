import { describe, expect, it } from "bun:test";
import { chatSpans, coldStartSpans } from "@f5-sales-demo/xcsh/browser/ttft-spans";

describe("chatSpans", () => {
	it("splits route->first-token into disjoint provider_ttft + chat_handler summing to the whole", () => {
		const spans = chatSpans("c-1", 100, 130, 430); // provider_ttft=300, chat_handler=30
		expect(spans).toEqual([
			{ type: "span", stage: "provider_ttft", ms: 300, id: "c-1" },
			{ type: "span", stage: "chat_handler", ms: 30, id: "c-1" },
		]);
		expect(spans[0].ms + spans[1].ms).toBe(430 - 100);
	});

	it("clamps negatives to 0 (guards against clock jitter)", () => {
		const spans = chatSpans("c-2", 100, 130, 120); // firstDelta before prompt
		expect(spans[0].ms).toBe(0);
	});
});

describe("coldStartSpans", () => {
	it("builds sid-tagged manager_provision + worker_boot carrying the cold flag", () => {
		expect(coldStartSpans("tab-7", true, 5, 800)).toEqual([
			{ type: "span", stage: "manager_provision", ms: 5, sid: "tab-7", cold: true },
			{ type: "span", stage: "worker_boot", ms: 800, sid: "tab-7", cold: true },
		]);
		expect(coldStartSpans("tab-9", false, 2, 5)[1]).toEqual({
			type: "span",
			stage: "worker_boot",
			ms: 5,
			sid: "tab-9",
			cold: false,
		});
	});
});
