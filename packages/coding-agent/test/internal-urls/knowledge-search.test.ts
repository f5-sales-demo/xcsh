import { describe, expect, it } from "bun:test";
import type { KnowledgeSearchPlan } from "../../src/internal-urls/knowledge-classifier";
import { searchKnowledgeStore } from "../../src/internal-urls/knowledge-search";

const plan: KnowledgeSearchPlan = {
	intent: "Find the authoritative API operation.",
	lex: ["dns zone", "create dns zone"],
	vec: ["create authoritative DNS zone"],
	hyde: ["An API reference describes the create DNS zone operation."],
};

describe("structured QMD knowledge search", () => {
	it("uses weighted structured search without query expansion", async () => {
		let received: Record<string, unknown> | undefined;
		const results = await searchKnowledgeStore(
			{
				search: async options => {
					received = options;
					return [{ displayPath: "catalog/dns.md", score: 0.72 }];
				},
				searchLex: async () => [],
			},
			plan,
			{ mode: "hybrid", corpus: "api", collections: ["catalog"], limit: 5, rerank: false },
		);
		expect(results).toHaveLength(1);
		expect(received).toEqual({
			queries: [
				{ type: "lex", query: "dns zone" },
				{ type: "lex", query: "create dns zone" },
				{ type: "vec", query: "create authoritative DNS zone" },
				{ type: "hyde", query: "An API reference describes the create DNS zone operation." },
			],
			intent: plan.intent,
			collections: ["catalog"],
			limit: 5,
			candidateLimit: 30,
			minScore: 0.2,
			explain: true,
			rerank: false,
		});
	});

	it("keeps the production BM25 path model-free and deterministically interleaved", async () => {
		const calls: string[] = [];
		const results = await searchKnowledgeStore(
			{
				search: async () => {
					throw new Error("hybrid search must not run");
				},
				searchLex: async query => {
					calls.push(query);
					return query === "dns zone"
						? [
								{ displayPath: "a", score: 1 },
								{ displayPath: "b", score: 0.8 },
							]
						: [
								{ displayPath: "b", score: 1 },
								{ displayPath: "c", score: 0.7 },
							];
				},
			},
			plan,
			{ mode: "bm25", corpus: "documentation", limit: 3 },
		);
		expect(calls).toEqual([...plan.lex]);
		expect(results.map(result => result.displayPath)).toEqual(["a", "b", "c"]);
	});
});
