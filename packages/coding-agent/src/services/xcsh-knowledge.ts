import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@f5-sales-demo/pi-utils";

export interface LlmsProduct {
	name: string;
	description: string;
	url: string;
}

export interface LlmsIndex {
	title: string;
	description: string;
	products: LlmsProduct[];
	fetchedAt: string;
}

const INFRASTRUCTURE_SLUGS = new Set([
	"docs-builder",
	"docs-theme",
	"docs-icons",
	"devcontainer",
	"xcsh",
	"docs",
	"cdn-simulator",
	"origin-server",
]);

const ENTRY_PATTERN = /^- \[([^\]]+)\]\(([^)]+)\):\s*(.+)$/;

function extractSlug(url: string): string | null {
	try {
		const pathname = new URL(url).pathname;
		const segments = pathname.split("/").filter(Boolean);
		return segments[0] ?? null;
	} catch {
		return null;
	}
}

export function parseLlmsTxt(content: string, now?: Date): LlmsIndex {
	const lines = content.split("\n");
	let title = "";
	let description = "";
	const products: LlmsProduct[] = [];
	let inFederatedSites = false;

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
			inFederatedSites = trimmed === "## Federated Sites";
			continue;
		}

		if (!inFederatedSites) continue;

		const match = ENTRY_PATTERN.exec(trimmed);
		if (!match) continue;

		const [, name, url, desc] = match;
		const slug = extractSlug(url);
		if (slug && INFRASTRUCTURE_SLUGS.has(slug)) continue;

		products.push({ name, description: desc, url });
	}

	return {
		title,
		description,
		products,
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
			const raw = fs.readFileSync(this.cachePath, "utf-8");
			this.#index = JSON.parse(raw) as LlmsIndex;
		} catch {
			this.#index = null;
		}
	}

	saveCache(index: LlmsIndex): void {
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
		const content = await response.text();
		const index = parseLlmsTxt(content);
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

	getProductNames(): string[] {
		if (!this.#index) return [];
		return this.#index.products.map(p => p.name).sort();
	}
}
