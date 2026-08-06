import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@f5-sales-demo/pi-utils";

export const KNOWLEDGE_CACHE_SCHEMA_VERSION = 2 as const;

export interface LlmsTopic {
	name: string;
	description: string;
	url: string;
	category: string;
}

export interface LlmsIndex {
	schemaVersion: typeof KNOWLEDGE_CACHE_SCHEMA_VERSION;
	title: string;
	description: string;
	topics: LlmsTopic[];
	fetchedAt: string;
}

const ENTRY_PATTERN = /^- \[([^\]]+)\]\(([^)]+)\):\s*(.+)$/;
const ROOT_LLMS_FILE = "llms.txt";
const PORTAL_SLUG = "docs";

function extractRootLlmsSlug(url: string): string | null {
	try {
		const segments = new URL(url).pathname.split("/").filter(Boolean);
		if (segments.length !== 2 || segments[1] !== ROOT_LLMS_FILE) return null;
		return segments[0] ?? null;
	} catch {
		return null;
	}
}

function isTopic(value: unknown): value is LlmsTopic {
	if (!value || typeof value !== "object") return false;
	const topic = value as Partial<LlmsTopic>;
	return (
		typeof topic.name === "string" &&
		typeof topic.description === "string" &&
		typeof topic.url === "string" &&
		typeof topic.category === "string"
	);
}

function isValidIndex(value: unknown): value is LlmsIndex {
	if (!value || typeof value !== "object") return false;
	const index = value as Partial<LlmsIndex>;
	return (
		index.schemaVersion === KNOWLEDGE_CACHE_SCHEMA_VERSION &&
		typeof index.title === "string" &&
		typeof index.description === "string" &&
		typeof index.fetchedAt === "string" &&
		!Number.isNaN(new Date(index.fetchedAt).getTime()) &&
		Array.isArray(index.topics) &&
		index.topics.length > 0 &&
		index.topics.every(isTopic)
	);
}

/**
 * Parse the root llms.txt portal into categorized documentation topics.
 *
 * Federation category headings are intentionally open-ended. A list entry is a
 * topic when it links to a sibling site's root /{slug}/llms.txt endpoint; this
 * excludes documentation sets, locale indexes, and tiered content without
 * hardcoding today's category names.
 */
export function parseLlmsTxt(content: string, now?: Date): LlmsIndex {
	const lines = content.split("\n");
	let title = "";
	let description = "";
	let category = "";
	const topics: LlmsTopic[] = [];
	const seenUrls = new Set<string>();

	for (const line of lines) {
		const trimmed = line.trim();

		if (!title && trimmed.startsWith("# ")) {
			title = trimmed.slice(2).trim();
			continue;
		}

		if (!description && trimmed.startsWith("> ")) {
			description = trimmed.slice(2).trim();
			continue;
		}

		if (trimmed.startsWith("## ")) {
			category = trimmed.slice(3).trim();
			continue;
		}

		const match = ENTRY_PATTERN.exec(trimmed);
		if (!match || !category) continue;

		const [, name, url, topicDescription] = match;
		const slug = extractRootLlmsSlug(url);
		if (!slug || slug === PORTAL_SLUG || seenUrls.has(url)) continue;

		seenUrls.add(url);
		topics.push({ name, description: topicDescription, url, category });
	}

	return {
		schemaVersion: KNOWLEDGE_CACHE_SCHEMA_VERSION,
		title,
		description,
		topics,
		fetchedAt: (now ?? new Date()).toISOString(),
	};
}

const ROOT_LLMS_URL = "https://f5-sales-demo.github.io/docs/llms.txt";
const DEFAULT_TTL_MS = 3_600_000;

export class KnowledgeService {
	static #instance: KnowledgeService | null = null;

	#configDir: string;
	#index: LlmsIndex | null = null;

	private constructor(configDir: string) {
		this.#configDir = configDir;
	}

	static init(configDir: string): KnowledgeService {
		KnowledgeService.#instance = new KnowledgeService(configDir);
		return KnowledgeService.#instance;
	}

	static get instance(): KnowledgeService {
		if (!KnowledgeService.#instance) {
			throw new Error("KnowledgeService not initialized. Call KnowledgeService.init() first.");
		}
		return KnowledgeService.#instance;
	}

	static _resetForTest(): void {
		KnowledgeService.#instance = null;
	}

	static _hasInstance(): boolean {
		return KnowledgeService.#instance !== null;
	}

	get cachePath(): string {
		return path.join(this.#configDir, "knowledge-cache.json");
	}

	loadCache(): void {
		try {
			if (!fs.existsSync(this.cachePath)) return;
			const parsed: unknown = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
			this.#index = isValidIndex(parsed) ? parsed : null;
		} catch {
			this.#index = null;
		}
	}

	saveCache(index: LlmsIndex): void {
		if (!isValidIndex(index)) return;
		try {
			fs.mkdirSync(this.#configDir, { recursive: true });
			fs.writeFileSync(this.cachePath, JSON.stringify(index, null, 2));
		} catch (err) {
			logger.debug("XCSH knowledge cache write failed", { error: String(err) });
		}
	}

	getIndex(): LlmsIndex | null {
		return this.#index;
	}

	async refreshIndex(): Promise<LlmsIndex> {
		const response = await fetch(ROOT_LLMS_URL, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch llms.txt: HTTP ${response.status}`);
		}
		const index = parseLlmsTxt(await response.text());
		if (index.topics.length === 0) {
			throw new Error("Failed to parse llms.txt: no federated documentation topics found");
		}
		this.#index = index;
		this.saveCache(index);
		return index;
	}

	async getOrRefreshIndex(ttlMs = DEFAULT_TTL_MS): Promise<LlmsIndex | null> {
		if (this.#index) {
			const age = Date.now() - new Date(this.#index.fetchedAt).getTime();
			if (age < ttlMs) return this.#index;
		}
		try {
			return await this.refreshIndex();
		} catch (err) {
			logger.debug("XCSH knowledge index refresh failed, using stale cache", { error: String(err) });
			return this.#index;
		}
	}

	getTopicNames(): string[] {
		if (!this.#index) return [];
		return this.#index.topics.map(topic => topic.name).sort();
	}

	getTopicSummary(): string {
		if (!this.#index) return "";
		const topicsByCategory = new Map<string, string[]>();
		for (const topic of this.#index.topics) {
			const names = topicsByCategory.get(topic.category) ?? [];
			names.push(topic.name);
			topicsByCategory.set(topic.category, names);
		}
		return [...topicsByCategory]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([category, names]) => `${category}: ${names.sort().join(", ")}`)
			.join("; ");
	}
}
