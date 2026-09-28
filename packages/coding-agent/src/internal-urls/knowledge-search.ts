import type { KnowledgeSearchPlan } from "./knowledge-classifier";

export type KnowledgeSearchMode = "bm25" | "hybrid";
export type KnowledgeSearchCorpus = "api" | "documentation";

export interface KnowledgeSearchResult {
	readonly displayPath: string;
	readonly score: number;
	readonly [key: string]: unknown;
}

export interface KnowledgeSearchStore<T extends KnowledgeSearchResult = KnowledgeSearchResult> {
	search(options: Record<string, unknown>): Promise<readonly T[]>;
	searchLex(query: string, options?: { limit?: number; collection?: string | string[] }): Promise<readonly T[]>;
}

export interface KnowledgeSearchOptions {
	readonly mode: KnowledgeSearchMode;
	readonly corpus: KnowledgeSearchCorpus;
	readonly collections?: readonly string[];
	readonly limit: number;
	readonly candidateLimit?: number;
	readonly rerank?: boolean;
	readonly explain?: boolean;
	readonly minScore?: number;
}

export const KNOWLEDGE_SCORE_THRESHOLDS = {
	api: 0.2,
	documentation: 0.25,
} as const;

function interleave<T extends KnowledgeSearchResult>(lists: readonly (readonly T[])[], limit: number): T[] {
	const results: T[] = [];
	const seen = new Set<string>();
	for (let position = 0; results.length < limit; position++) {
		let found = false;
		for (const list of lists) {
			const result = list[position];
			if (!result) continue;
			found = true;
			if (!seen.has(result.displayPath)) {
				seen.add(result.displayPath);
				results.push(result);
				if (results.length === limit) break;
			}
		}
		if (!found) break;
	}
	return results;
}

/**
 * Runs a deterministic structured query. The BM25 mode never invokes model
 * APIs; hybrid mode supplies typed queries so QMD never loads its expansion
 * model. Native/model errors deliberately propagate to the caller.
 */
export async function searchKnowledgeStore<T extends KnowledgeSearchResult>(
	store: KnowledgeSearchStore<T>,
	plan: KnowledgeSearchPlan,
	options: KnowledgeSearchOptions,
): Promise<readonly T[]> {
	if (options.mode === "bm25") {
		const lists: Array<readonly T[]> = [];
		for (const query of plan.lex) {
			lists.push(
				await store.searchLex(query, {
					limit: options.limit,
					collection: options.collections ? [...options.collections] : undefined,
				}),
			);
		}
		return interleave(lists, options.limit);
	}

	return store.search({
		queries: [
			...plan.lex.map(query => ({ type: "lex" as const, query })),
			...plan.vec.map(query => ({ type: "vec" as const, query })),
			...plan.hyde.map(query => ({ type: "hyde" as const, query })),
		],
		intent: plan.intent,
		collections: options.collections ? [...options.collections] : undefined,
		limit: options.limit,
		candidateLimit: options.candidateLimit ?? 30,
		minScore: options.minScore ?? KNOWLEDGE_SCORE_THRESHOLDS[options.corpus],
		explain: options.explain ?? true,
		rerank: options.rerank ?? false,
	});
}
