// biome-ignore lint/correctness/noUnusedImports: used in Task 2 (KnowledgeService)
import * as fs from "node:fs";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2 (KnowledgeService)
import * as path from "node:path";
// biome-ignore lint/correctness/noUnusedImports: used in Task 2 (KnowledgeService)
import { logger } from "@f5xc-salesdemos/pi-utils";

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
