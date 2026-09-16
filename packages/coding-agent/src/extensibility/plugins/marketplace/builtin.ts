import { createHash } from "node:crypto";
import provenance from "./builtin-marketplace.provenance.json";
import snapshotJson from "./builtin-marketplace-snapshot";
import { parseMarketplaceCatalog } from "./fetcher";
import type { MarketplaceCatalog, MarketplaceRegistryEntry } from "./types";

export const BUILTIN_MARKETPLACE_NAME = "f5-sales-demo-marketplace";
export const BUILTIN_MARKETPLACE_SOURCE = "f5-sales-demo/marketplace";
export const BUILTIN_MARKETPLACE_PROVENANCE = provenance;

export function isBuiltinMarketplaceSource(source: string): boolean {
	const normalized = source
		.trim()
		.toLowerCase()
		.replace(/^git@github\.com:/, "")
		.replace(/^https?:\/\/github\.com\//, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
	return normalized === BUILTIN_MARKETPLACE_SOURCE;
}

export function getBuiltinMarketplaceSnapshot(): { catalog: MarketplaceCatalog; json: string } {
	const actual = createHash("sha256").update(snapshotJson).digest("hex");
	if (actual !== provenance.sha256) {
		throw new Error(
			`Built-in marketplace snapshot failed integrity validation: expected ${provenance.sha256}, got ${actual}`,
		);
	}
	const catalog = parseMarketplaceCatalog(snapshotJson, `embedded:${provenance.sourcePath}`);
	if (catalog.name !== BUILTIN_MARKETPLACE_NAME) {
		throw new Error(
			`Built-in marketplace snapshot name must be "${BUILTIN_MARKETPLACE_NAME}", got "${catalog.name}"`,
		);
	}
	return { catalog, json: snapshotJson };
}

export function createBuiltinMarketplaceEntry(catalogPath: string): MarketplaceRegistryEntry {
	return {
		name: BUILTIN_MARKETPLACE_NAME,
		sourceType: "github",
		sourceUri: BUILTIN_MARKETPLACE_SOURCE,
		catalogPath,
		addedAt: provenance.capturedAt,
		updatedAt: provenance.capturedAt,
		enabled: true,
		builtIn: true,
	};
}
