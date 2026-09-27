import type { AgentTool } from "@f5-sales-demo/pi-agent-core";

export interface DiscoverableTool {
	name: string;
	label: string;
	description: string;
	schemaKeys: string[];
}

export interface DiscoverableToolSearchDocument {
	tool: DiscoverableTool;
	termFrequencies: Map<string, number>;
	length: number;
}

export interface DiscoverableToolSearchIndex {
	documents: DiscoverableToolSearchDocument[];
	averageLength: number;
	documentFrequencies: Map<string, number>;
}

export interface DiscoverableToolSearchResult {
	tool: DiscoverableTool;
	score: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const FIELD_WEIGHTS = {
	name: 6,
	label: 4,
	description: 2,
	schemaKey: 1,
} as const;

function getSchemaPropertyKeys(parameters: unknown): string[] {
	if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return [];
	const properties = (parameters as { properties?: unknown }).properties;
	if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
	return Object.keys(properties as Record<string, unknown>).sort();
}

function tokenize(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[^a-zA-Z0-9]+/g, " ")
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.filter(token => token.length > 0);
}

function addWeightedTokens(termFrequencies: Map<string, number>, value: string | undefined, weight: number): void {
	if (!value) return;
	for (const token of tokenize(value)) {
		termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + weight);
	}
}

function buildSearchDocument(tool: DiscoverableTool): DiscoverableToolSearchDocument {
	const termFrequencies = new Map<string, number>();
	addWeightedTokens(termFrequencies, tool.name, FIELD_WEIGHTS.name);
	addWeightedTokens(termFrequencies, tool.label, FIELD_WEIGHTS.label);
	addWeightedTokens(termFrequencies, tool.description, FIELD_WEIGHTS.description);
	for (const schemaKey of tool.schemaKeys) {
		addWeightedTokens(termFrequencies, schemaKey, FIELD_WEIGHTS.schemaKey);
	}
	const length = Array.from(termFrequencies.values()).reduce((sum, value) => sum + value, 0);
	return { tool, termFrequencies, length };
}

/** Build safe search metadata for any registered tool source. */
export function getDiscoverableTool(tool: AgentTool): DiscoverableTool {
	const toolRecord = tool as AgentTool & {
		label?: string;
		description?: string;
		parameters?: unknown;
	};
	return {
		name: tool.name,
		label: typeof toolRecord.label === "string" ? toolRecord.label : tool.name,
		description: typeof toolRecord.description === "string" ? toolRecord.description : "",
		schemaKeys: getSchemaPropertyKeys(toolRecord.parameters),
	};
}

export function collectDiscoverableTools(tools: Iterable<AgentTool>): DiscoverableTool[] {
	return Array.from(tools, getDiscoverableTool);
}

export function buildDiscoverableToolSearchIndex(tools: Iterable<DiscoverableTool>): DiscoverableToolSearchIndex {
	const documents = Array.from(tools, buildSearchDocument);
	const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length || 1;
	const documentFrequencies = new Map<string, number>();
	for (const document of documents) {
		for (const token of new Set(document.termFrequencies.keys())) {
			documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
		}
	}
	return {
		documents,
		averageLength,
		documentFrequencies,
	};
}

export function searchDiscoverableTools(
	index: DiscoverableToolSearchIndex,
	query: string,
	limit: number,
): DiscoverableToolSearchResult[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) {
		throw new Error("Query must contain at least one letter or number.");
	}
	if (index.documents.length === 0) {
		return [];
	}

	const queryTermCounts = new Map<string, number>();
	for (const token of queryTokens) {
		queryTermCounts.set(token, (queryTermCounts.get(token) ?? 0) + 1);
	}

	return index.documents
		.map(document => {
			let score = 0;
			for (const [token, queryTermCount] of queryTermCounts) {
				const termFrequency = document.termFrequencies.get(token) ?? 0;
				if (termFrequency === 0) continue;
				const documentFrequency = index.documentFrequencies.get(token) ?? 0;
				const idf = Math.log(1 + (index.documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
				const normalization = BM25_K1 * (1 - BM25_B + BM25_B * (document.length / index.averageLength));
				score += queryTermCount * idf * ((termFrequency * (BM25_K1 + 1)) / (termFrequency + normalization));
			}
			return { tool: document.tool, score };
		})
		.filter(result => result.score > 0)
		.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
		.slice(0, limit);
}
